'use strict';
// Deterministic utterance -> intent JSON. No LLM here; an LLM may only be a caller-side fallback.
const { tokenize, scanTokens, isNumeralWord } = require('./numerals');
const { PACKS, UNION: U, detectLang, render } = require('./langpacks');
const G = require('./guardrails');

const PUNCT = new Set([',', '?', '।', '|', '₹']);
const SPLIT = new Set([',', '।', '|']);

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cap = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const isFuture = (w) => U.future.has(w) || /(unga|ungi|enge|ega|egi)$/.test(w);

// Date offset for a clause. "kal"/"parso" are bidirectional in Hindi/Bengali: resolve by tense.
function clauseDate(words, lang, today) {
  const P = PACKS[lang] || PACKS.hi;
  const past = words.some((w) => U.past.has(w));
  const future = !past && words.some(isFuture);
  const inPack = (k, w) => (P.dates[k] || []).includes(w);
  for (const w of words) {
    for (const src of [(k) => inPack(k, w), (k) => U[k].has(w)]) { // the speaker's own pack wins (Marathi kal = yesterday)
      if (src('today')) return { date: today, conf: 1 };
      if (src('yesterday')) return { date: addDays(today, -1), conf: 1 };
      if (src('tomorrow')) return { date: addDays(today, 1), conf: 1, future: true };
      if (src('kal')) return future ? { date: addDays(today, 1), conf: 0.95, future: true } : { date: addDays(today, -1), conf: past ? 0.95 : 0.8 };
      if (src('parso')) return future ? { date: addDays(today, 2), conf: 0.95, future: true } : { date: addDays(today, -2), conf: past ? 0.95 : 0.8 };
    }
  }
  return null;
}

const aliasList = (c) => [c.name, ...(Array.isArray(c.aliases) ? c.aliases : String(c.aliases || '').split(','))].filter(Boolean);
const SUFFIX = [['agent', U.agent_suffix], ['recipient', U.recipient_suffix], ['possessive', U.possessive_suffix]];

// Who is this clause about? Known customers first (alias + attached case suffix aware), else first unknown-word run.
function findCustomer(toks, used, customers) {
  const words = toks.map((x) => x.t);
  if (customers && customers.length) {
    let best = 0, hits = [];
    for (const c of customers) {
      let score = 0, at = null;
      for (const key of aliasList(c)) {
        const kt = key.toLowerCase().split(/\s+/);
        let s = 0, first = null;
        for (const k of kt) {
          for (let i = 0; i < words.length; i++) {
            if (used.has(i)) continue;
            const w = words[i];
            let suffix = null;
            if (w !== k) {
              const m = SUFFIX.find(([, set]) => [...set].some((sf) => w === k + sf));
              if (!m) continue;
              suffix = m[0];
            }
            s++;
            if (!first) first = { idx: i, len: 1, suffix };
            break;
          }
        }
        if (s > score) { score = s; at = first; }
      }
      if (score > best) { best = score; hits = [{ c, at }]; } else if (score && score === best) hits.push({ c, at });
    }
    const ids = [...new Set(hits.map((h) => h.c.id))];
    if (ids.length > 1) return { ambiguous: true, name: cap(words[hits[0].at.idx]), candidates: hits.map((h) => ({ id: h.c.id, name: h.c.name })) };
    if (hits.length) return { id: hits[0].c.id, name: hits[0].c.name, ...hits[0].at };
  }
  for (let i = 0; i < words.length; i++) {
    const unknown = (k) => k < words.length && !used.has(k) && /^\p{L}+$/u.test(words[k]) && !U.all.has(words[k]) && !isNumeralWord(words[k]);
    if (!unknown(i)) continue;
    let j = i;
    while (unknown(j)) j++;
    return { id: null, name: cap(words.slice(i, j).join(' ')), idx: i, len: j - i, suffix: null };
  }
  return null;
}

// Case marker around the name: postpositions after (ne/ko/la/se/ka), prepositions before (to/from).
function markerOf(words, who) {
  if (who.suffix) return who.suffix;
  const after = words[who.idx + who.len], before = words[who.idx - 1];
  if (U.agent.has(after)) return 'agent';
  if (U.recipient.has(after) || U.prep_recipient.has(before)) return 'recipient';
  if (U.source.has(after) || U.prep_source.has(before)) return 'source';
  if (U.possessive.has(after)) return 'possessive';
  return null;
}

// Direction by verb class + case marker. Returns {direction, conf} with direction null when we must ASK.
function directionOf(words, who, inherited, lang) {
  const has = (set) => words.some((w) => set.has(w));
  if (has(U.payment_verbs)) return { direction: 'payment', conf: 1 };
  if (has(U.credit_verbs)) return { direction: 'credit', conf: 1 };
  const give = words.findIndex((w) => U.give_verbs.has(w));
  const take = words.findIndex((w) => U.take_verbs.has(w));
  if (give < 0 && take < 0) return { direction: null };
  const marker = who && !inherited ? markerOf(words, who) : null;
  if (take >= 0 && give < 0) return { direction: marker === 'source' ? 'payment' : 'credit', conf: 0.9 }; // "Ramesh se liya" = I received
  if (marker === 'agent') return { direction: 'payment', conf: 1 };      // Ramesh NE diya
  if (marker === 'recipient') return { direction: 'credit', conf: 1 };   // Ramesh KO diya
  // Pro-drop: "Ramesh ka 340 udhaar, kal 200 diya tha" -> the topic customer is the unstated giver.
  if (inherited) return { direction: 'payment', conf: 0.85 };
  // Subject-first languages without ergative marker: "Ramesh gave 200", "Ramesh 200 diyeche".
  if (who && !marker && (PACKS[lang] || {}).subject_first && who.idx < give) return { direction: 'payment', conf: 0.85 };
  // Hindi "ne" is perfective-only; a bare subject with a future give verb is the giver: "Ramesh kal 200 dega".
  if (who && !marker && who.idx < give && !words.some((w) => U.past.has(w)) && words.some(isFuture)) return { direction: 'payment', conf: 0.85 };
  return { direction: null };
}

function splitClauses(toks) {
  const out = [[]];
  for (const t of toks) {
    if (SPLIT.has(t.t) || U.conj.has(t.t)) { if (out[out.length - 1].length) out.push([]); continue; }
    if (t.t !== '?') out[out.length - 1].push(t);
  }
  return out.filter((c) => c.length);
}

const usedSet = (runs) => { const s = new Set(); for (const r of runs) for (let k = r.start; k < r.end; k++) s.add(k); return s; };
const moneyRun = (runs) => runs.find((r) => r.kind === 'money' && r.confidence >= 0.5);
const disambiguate = (base, who, lang, extra = {}) => ({ ...base, intent: 'disambiguate', slot: 'customer', candidates: who.candidates,
  question: render(lang, 'disambiguate', { name: who.name, options: who.candidates.map((c) => c.name).join(' / ') }), ...extra });

function parseEntries(toks, base, lang, ctx, today) {
  const entries = [];
  let topic = ctx.lastCustomer || null; // {id, name}
  for (const clause of splitClauses(toks)) {
    const words = clause.map((x) => x.t);
    const runs = scanTokens(clause, lang);
    const money = moneyRun(runs);
    const who = findCustomer(clause, usedSet(runs), ctx.customers);
    if (who && who.ambiguous) return disambiguate(base, who, lang, { entries });
    const inherited = !who;
    if (who) topic = { id: who.id, name: who.name };
    const dir = directionOf(words, who, inherited && !!topic, lang);
    if (!money) {
      if (dir.direction) return { ...base, intent: 'clarify', slot: 'amount', entries, question: render(lang, 'clarify_amount') };
      continue; // e.g. a clause that only names the customer
    }
    if (!topic) return { ...base, intent: 'clarify', slot: 'customer', entries, question: render(lang, 'clarify_customer') };
    if (!dir.direction) {
      return { ...base, intent: 'clarify', slot: 'direction', entries, pending: { customer: topic, paise: money.paise },
        question: render(lang, 'clarify_direction', { name: topic.name }) };
    }
    const d = clauseDate(words, lang, today) || { date: today, conf: 1 };
    entries.push({ customer: topic, direction: dir.direction, paise: money.paise, date: d.date,
      confidence: Math.min(money.confidence, dir.conf, d.conf), ...(d.future ? { future: true } : {}) });
  }
  if (!entries.length) return { ...base, intent: 'clarify', slot: 'utterance', question: render(lang, 'clarify_repeat') };
  return { ...base, intent: 'add_entries', entries };
}

// "nahi, 430" etc. Patches one slot of ctx.lastIntent and returns the patched intent for read-back.
function parseCorrection(rest, base, lang, ctx, today) {
  const last = ctx.lastIntent;
  const patched = JSON.parse(JSON.stringify(last));
  const ents = patched.entries;
  const words = rest.map((x) => x.t).filter((w) => !PUNCT.has(w));
  const runs = scanTokens(rest, lang);
  const money = moneyRun(runs);
  const out = (slot, value, entryIndex) => ({ ...base, intent: 'correct_slot', slot, value, entryIndex, patched });
  if (money) {
    // shortcut: with several entries, patch the one whose amount is closest (430 vs 340 = misheard); ask if this misfires in demos.
    let i = 0;
    ents.forEach((e, k) => { if (Math.abs(e.paise - money.paise) < Math.abs(ents[i].paise - money.paise)) i = k; });
    ents[i].paise = money.paise;
    return out('amount', money.paise, i);
  }
  const i = ents.length - 1;
  if (words.some((w) => U.payment_verbs.has(w))) { ents[i].direction = 'payment'; return out('direction', 'payment', i); }
  if (words.some((w) => U.credit_verbs.has(w))) { ents[i].direction = 'credit'; return out('direction', 'credit', i); }
  const d = clauseDate(words, lang, today);
  if (d) { ents[i].date = d.date; return out('date', d.date, i); }
  const who = findCustomer(rest, usedSet(runs), ctx.customers);
  if (who && who.ambiguous) return disambiguate(base, who, lang);
  if (who) { const c = { id: who.id, name: who.name }; ents.forEach((e) => { e.customer = c; }); return out('customer', c, null); }
  return { ...base, intent: 'deny' };
}

/**
 * parse(text, ctx) -> intent JSON.
 * ctx: { lang?, today?: 'YYYY-MM-DD', customers?: [{id,name,aliases}], lastIntent?, lastCustomer?: {id,name} }
 */
function parse(text, ctx = {}) {
  const toks = tokenize(text);
  const words = toks.map((x) => x.t).filter((w) => !PUNCT.has(w));
  const lang = ctx.lang || detectLang(words);
  const today = ctx.today || localToday();
  const base = { text, lang };
  const has = (set) => words.some((w) => set.has(w));

  if (!words.length) return { ...base, intent: 'clarify', slot: 'utterance', question: render(lang, 'clarify_repeat') };
  if (has(U.lending)) return { ...base, intent: 'refuse', ...G.refuseLending(lang) };
  if (has(U.diagnosis)) return { ...base, intent: 'refuse', ...G.refuseDiagnosis(lang) };
  if (words.some((w) => U.yes.has(w)) && words.every((w) => U.yes.has(w) || U.filler.has(w))) return { ...base, intent: 'confirm' };
  if (U.no.has(words[0])) {
    const rest = toks.slice(toks.findIndex((x) => x.t === words[0]) + 1).filter((x) => !U.no.has(x.t));
    if (rest.some((x) => !PUNCT.has(x.t)) && ctx.lastIntent && ctx.lastIntent.entries && ctx.lastIntent.entries.length) {
      return parseCorrection(rest, base, lang, ctx, today);
    }
    return { ...base, intent: 'deny' };
  }

  const runs = scanTokens(toks, lang);
  const money = moneyRun(runs);
  const who = () => findCustomer(toks.filter((x) => !PUNCT.has(x.t)), usedSet([]), ctx.customers);

  if (has(U.undo) && !money) return { ...base, intent: 'undo', target: 'last' };
  if (has(U.create) && has(U.customer_nouns)) {
    const c = who();
    return c ? { ...base, intent: 'create_customer', name: c.name } : { ...base, intent: 'clarify', slot: 'customer', question: render(lang, 'clarify_customer') };
  }
  if (has(U.reminder)) {
    const c = who();
    if (c && c.ambiguous) return disambiguate(base, c, lang);
    return c ? { ...base, intent: 'reminder_optin', customer: { id: c.id, name: c.name } }
      : { ...base, intent: 'clarify', slot: 'customer', question: render(lang, 'clarify_customer') };
  }
  if (!money && (has(U.query) || toks.some((x) => x.t === '?'))) {
    const c = who();
    if (c && c.ambiguous) return disambiguate(base, c, lang);
    if (c) return { ...base, intent: 'query_balance', customer: { id: c.id, name: c.name } };
    const d = clauseDate(words, lang, today);
    if (d) {
      const direction = has(U.payment_verbs) ? 'payment' : has(U.credit_verbs) ? 'credit' : null;
      return { ...base, intent: 'query_day_total', date: d.date, direction };
    }
    return { ...base, intent: 'query_balance', customer: null }; // whole-shop receivable
  }
  return parseEntries(toks, base, lang, ctx, today);
}

module.exports = { parse };
