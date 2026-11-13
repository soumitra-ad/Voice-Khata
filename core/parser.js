'use strict';
// Deterministic utterance -> intent JSON. No LLM here; an LLM may only be a caller-side fallback.
const { tokenize, scanTokens, pickMoney, isNumeralWord, isNumeralToken, normText } = require('./numerals');
const { PACKS, UNION: U, detectLangScore, render, lexWord } = require('./langpacks');
const { canonicalKey } = require('./translit');
const G = require('./guardrails');

const PUNCT = new Set([',', '?', '|', '₹']);
const SPLIT = new Set([',', '|']);
const ORDINALS = ['first', 'second', 'third'];

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cap = (s) => s.replace(/(^|\s)(\p{L})/gu, (_, a, c) => a + c.toUpperCase());
const isFuture = (w) => U.future.has(w) || /(unga|ungi|enge|ega|egi)$/.test(w);
const rupees = (paise) => String(paise / 100);
const joined = (words) => ` ${words.join(' ')} `;
const RECEIVED = / (aa|mil) (gaya|gaye|gayi) | aale | peyechi | peyeche /;
const FULFIL = / (aa|mil) (gaya|gaye|gayi) | abhi likh do | aale | peyechi | peyeche | received /;
const WILL_ARRIVE = / aa (jayega|jayegi|jayenge) /;

// Date for a clause. "kal"/"parso" are bidirectional in Hindi/Bengali: resolve by tense.
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
const nameTokens = (s) => normText(s).toLowerCase().split(/\s+/).filter(Boolean);
const SUFFIX = [['agent', U.agent_suffix], ['recipient', U.recipient_suffix], ['possessive', U.possessive_suffix]];
const POSS_SUFFIX = [...U.possessive_suffix].sort((a, b) => b.length - a.length);
const NATIVE_POSS = ['च्या', 'चा', 'ची', 'चे', 'ের', 'এর']; // same suffixes in original script, for the display name
// Roster names match on canonical keys too, so रमेश / romesh match stored "Ramesh".
const sameName = (a, b) => a === b || canonicalKey(a) === canonicalKey(b);
const cust = (c) => ({ id: c.id, name: c.name, ...(c.display ? { display: c.display } : {}) });

// Who is this clause about? Known customers first (alias + attached case suffix aware), else first unknown-word run.
function findCustomer(toks, used, customers) {
  const words = toks.map((x) => x.t);
  if (customers && customers.length) {
    let best = 0, hits = [];
    for (const c of customers) {
      let score = 0, at = null;
      for (const key of aliasList(c)) {
        let s = 0, first = null;
        for (const k of nameTokens(key)) {
          for (let i = 0; i < words.length; i++) {
            if (used.has(i)) continue;
            const w = words[i];
            let suffix = null;
            if (!sameName(w, k)) {
              const m = SUFFIX.find(([, set]) => [...set].some((sf) => sameName(w, k + sf)));
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
    const unknown = (k) => k < words.length && !used.has(k) && /^[\p{L}\p{M}]+$/u.test(words[k]) && !U.all.has(words[k]) && !isNumeralWord(words[k]);
    if (!unknown(i)) continue;
    let j = i;
    while (unknown(j)) j++;
    const parts = toks.slice(i, j), names = parts.map((x) => x.t), shown = parts.map((x) => x.raw);
    let suffix = null;
    // Attached possessive in native script: রমেশের = Ramesh + -er, रमेशचा = Ramesh + -cha. Name keeps the stem.
    const lastTok = parts[parts.length - 1];
    const sf = lastTok.native && POSS_SUFFIX.find((x) => lastTok.t.endsWith(x) && lastTok.t.length - x.length >= 3);
    if (sf) {
      names[names.length - 1] = lastTok.t.slice(0, -sf.length);
      const ns = NATIVE_POSS.find((x) => lastTok.raw.endsWith(x));
      if (ns) shown[shown.length - 1] = lastTok.raw.slice(0, -ns.length);
      suffix = 'possessive';
    }
    const display = parts.some((x) => x.native) ? shown.join(' ') : undefined;
    return { id: null, name: cap(names.join(' ')), display, idx: i, len: j - i, suffix };
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
  const s = joined(words);
  if (has(U.payment_verbs) || RECEIVED.test(s) || WILL_ARRIVE.test(s)) return { direction: 'payment', conf: 1 };
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

// Speech-to-text often drops commas: "रमेश का 340 रुपये उधार कल 200 दिया था" is two clauses with no separator.
// Split a clause that holds 2+ money amounts right after the last direction/tense word before the next amount,
// so "कल" travels with the second entry. No direction/tense word in between = no split (never guess).
const BOUNDARY = (w) => U.credit_verbs.has(w) || U.payment_verbs.has(w) || U.give_verbs.has(w) || U.take_verbs.has(w)
  || U.past.has(w) || U.future.has(w);
function splitOnAmounts(clause, lang, opts) {
  const money = scanTokens(clause, lang, opts).filter((r) => r.kind === 'money' && r.confidence >= 0.5);
  for (let k = 1; k < money.length; k++) {
    let cut = -1;
    for (let i = money[k - 1].end; i < money[k].start; i++) if (BOUNDARY(clause[i].t)) cut = i + 1;
    if (cut > 0) return [clause.slice(0, cut), ...splitOnAmounts(clause.slice(cut), lang, opts)];
  }
  return [clause];
}

const usedSet = (runs) => { const s = new Set(); for (const r of runs) for (let k = r.start; k < r.end; k++) s.add(k); return s; };
const disambiguate = (base, who, lang, extra = {}) => ({ ...base, intent: 'disambiguate', slot: 'customer', candidates: who.candidates,
  question: render(lang, 'disambiguate', { name: who.name, options: who.candidates.map((c) => c.name).join(' / ') }), ...extra });

function whenWord(due, today, lang) {
  if (!due) return '';
  const when = (PACKS[lang] && PACKS[lang].when) || PACKS.hi.when;
  return when[dayDiff(due, today)] || due;
}

function parseEntries(toks, base, lang, ctx, today, opts) {
  const entries = [], promises = [];
  let topic = ctx.lastCustomer || null; // {id, name}
  for (const clause of splitClauses(toks).flatMap((c) => splitOnAmounts(c, lang, opts))) {
    const words = clause.map((x) => x.t);
    const runs = scanTokens(clause, lang, opts);
    const money = pickMoney(runs);
    const who = findCustomer(clause, usedSet(runs), ctx.customers);
    if (who && who.ambiguous) return disambiguate(base, who, lang, { entries });
    const inherited = !who;
    if (who) topic = cust(who);
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
    const d = clauseDate(words, lang, today);
    const future = !words.some((w) => U.past.has(w)) && ((d && d.future) || words.some(isFuture));
    if (future) {
      // Not yet happened: a promise to pay is a note, never a ledger entry. Future credit is not recorded either.
      if (dir.direction !== 'payment') return { ...base, intent: 'clarify', slot: 'tense', entries, question: render(lang, 'clarify_future_credit') };
      promises.push({ customer: topic, paise: money.paise, due_on: d ? d.date : null });
      continue;
    }
    const date = d || { date: today, conf: 1 };
    entries.push({ customer: topic, direction: dir.direction, paise: money.paise, date: date.date,
      confidence: Math.min(money.confidence, dir.conf, date.conf) });
  }
  if (entries.length) return { ...base, intent: 'add_entries', entries, ...(promises.length ? { promises } : {}) };
  if (promises.length) {
    const p = promises[0];
    return { ...base, intent: 'promise_note', promise: p, promises,
      reply: render(lang, 'promise_saved', { when: whenWord(p.due_on, today, lang), amount: rupees(p.paise) }) };
  }
  return { ...base, intent: 'clarify', slot: 'utterance', question: render(lang, 'clarify_repeat') };
}

// Which entry does a correction target? Deterministic order (never numeric proximity):
//   a. explicit selector: ordinal ("pehla"/"doosra") or "<amount|date|udhaar|jama> wala"
//   b. exactly one entry   c. the primary clause (first entry, dated today)   d. else ask.
function pickTarget(rest, ents, lang, today, opts) {
  const words = rest.map((x) => x.t);
  const used = new Set();
  const ord = ORDINALS.findIndex((f) => words.some((w) => U[f].has(w)));
  if (ord >= 0) {
    words.forEach((w, i) => { if (ORDINALS.some((f) => U[f].has(w))) used.add(i); });
    return { cand: ents[ord] ? [ord] : [], used };
  }
  const wi = words.findIndex((w) => U.wala.has(w));
  if (wi > 0) {
    for (let k = 0; k <= wi; k++) used.add(k);
    const phrase = rest.slice(0, wi), pw = phrase.map((x) => x.t);
    const amt = pickMoney(scanTokens(phrase, lang, opts));
    const d = clauseDate(pw, lang, today);
    const dir = pw.some((w) => U.payment_verbs.has(w)) ? 'payment' : pw.some((w) => U.credit_verbs.has(w)) ? 'credit' : null;
    if (!amt && !d && !dir) return { cand: [], used };
    const cand = ents.map((_, i) => i).filter((i) => (!amt || ents[i].paise === amt.paise) && (!d || ents[i].date === d.date) && (!dir || ents[i].direction === dir));
    return { cand, used };
  }
  return { cand: null, used };
}

// "nahi, 430" / "kal wala nahi, 250". Patches one slot of ctx.lastIntent and returns the patched intent for read-back.
function parseCorrection(rest, base, lang, ctx, today, opts) {
  const patched = JSON.parse(JSON.stringify(ctx.lastIntent));
  const ents = patched.entries;
  const askTarget = () => ({ ...base, intent: 'clarify', slot: 'correction_target', entries: ents,
    question: render(lang, 'clarify_target', { options: ents.map((e) => render(lang, 'target_option', { amount: rupees(e.paise) })).join(` ${render(lang, 'target_join')} `) }) });
  let { cand, used } = pickTarget(rest, ents, lang, today, opts);
  const value = rest.filter((_, i) => !used.has(i));
  const vwords = value.map((x) => x.t);
  const money = pickMoney(scanTokens(value, lang, opts));
  const dirWord = vwords.some((w) => U.payment_verbs.has(w)) ? 'payment' : vwords.some((w) => U.credit_verbs.has(w)) ? 'credit' : null;
  let target;
  if (cand && cand.length === 1) target = cand[0];
  else if (cand && !cand.length) return askTarget();
  // A named slot next to a new amount selects by direction: "nahi, udhaar 430".
  if (target === undefined && money && dirWord) {
    const byDir = ents.map((_, i) => i).filter((i) => ents[i].direction === dirWord);
    if (byDir.length === 1) target = byDir[0];
  }
  if (target === undefined) {
    if (ents.length === 1) target = 0;
    else if (ents[0].date === today) target = 0;
    else return askTarget();
  }
  const out = (slot, v, entryIndex) => ({ ...base, intent: 'correct_slot', slot, value: v, entryIndex, patched });
  if (money) { ents[target].paise = money.paise; return out('amount', money.paise, target); }
  if (dirWord) { ents[target].direction = dirWord; return out('direction', dirWord, target); }
  const d = clauseDate(vwords, lang, today);
  if (d) { ents[target].date = d.date; return out('date', d.date, target); }
  const who = findCustomer(value, new Set(), ctx.customers);
  if (who && who.ambiguous) return disambiguate(base, who, lang);
  if (who) { const c = { id: who.id, name: who.name }; ents.forEach((e) => { e.customer = c; }); return out('customer', c, null); }
  return { ...base, intent: 'deny' };
}

/**
 * parse(text, ctx) -> intent JSON.
 * ctx: { lang?, today?: 'YYYY-MM-DD', customers?: [{id,name,aliases}], lastIntent?, lastCustomer?: {id,name},
 *        openPromise?: {customer, paise, due_on, id?} }
 */
function parse(text, ctx = {}) {
  // Transliterated tokens resolve to lexicon words; tok.raw and the returned `text` keep the original script.
  const toks = tokenize(text).map((x) => {
    if (PUNCT.has(x.t) || /^\d/.test(x.t) || U.all.has(x.t) || isNumeralToken(x)) return x;
    const r = lexWord(x.t);
    return r ? { ...x, t: r } : x;
  });
  const words = toks.map((x) => x.t).filter((w) => !PUNCT.has(w));
  // Parsing always uses the union lexicon; detection is for the REPLY only, and only when it is confident.
  const detected = detectLangScore(words);
  const lang = ctx.lang || detected.lang;
  const today = ctx.today || localToday();
  const base = { text, lang, ...(detected.score >= 2 ? { replyLang: detected.lang } : {}) };
  const has = (set) => words.some((w) => set.has(w));
  // Known customer names are never fuzzy-matched into numbers.
  // A word right before a possessive marker (ka/ke/का/-er/-cha) is a name: never canonical/fuzzy-folded into a number.
  const noLoose = new Set(toks.filter((x, i) => !/^\d/.test(x.t) && ((toks[i + 1] && U.possessive.has(toks[i + 1].t)) ||
    (x.native && POSS_SUFFIX.some((sf) => x.t.endsWith(sf))))).map((x) => x.t));
  const opts = { exclude: new Set((ctx.customers || []).flatMap((c) => aliasList(c).flatMap(nameTokens))), noLoose };

  if (!words.length) return { ...base, intent: 'clarify', slot: 'utterance', question: render(lang, 'clarify_repeat') };
  if (has(U.lending)) return { ...base, intent: 'refuse', ...G.refuseLending(lang) };
  if (has(U.diagnosis)) return { ...base, intent: 'refuse', ...G.refuseDiagnosis(lang) };
  if (words.some((w) => U.yes.has(w)) && words.every((w) => U.yes.has(w) || U.filler.has(w))) return { ...base, intent: 'confirm' };

  // Correction: starts with a no-word, or a selector precedes it ("kal wala nahi, 250").
  const noIdx = words.findIndex((w) => U.no.has(w));
  const selectorFirst = noIdx > 0 && noIdx <= 3 && words.slice(0, noIdx).some((w) => U.wala.has(w) || ORDINALS.some((f) => U[f].has(w)));
  if (noIdx === 0 || selectorFirst) {
    const rest = toks.filter((x) => !PUNCT.has(x.t) && !U.no.has(x.t));
    const last = ctx.lastIntent;
    if (rest.length && last && last.entries && last.entries.length) return parseCorrection(rest, base, lang, ctx, today, opts);
    return { ...base, intent: 'deny' };
  }

  // "aa gaya" / "abhi likh do" right after a promise turns it into a real payment.
  const promise = ctx.openPromise || (ctx.lastIntent && ctx.lastIntent.intent === 'promise_note' && ctx.lastIntent.promise);
  if (promise && FULFIL.test(joined(words))) {
    const m = pickMoney(scanTokens(toks, lang, opts));
    return { ...base, intent: 'promise_fulfil', promise, entry: { customer: promise.customer, direction: 'payment',
      paise: m ? m.paise : promise.paise, date: today, confidence: 1 } };
  }

  const money = pickMoney(scanTokens(toks, lang, opts));
  const who = () => findCustomer(toks.filter((x) => !PUNCT.has(x.t)), new Set(), ctx.customers);

  if (has(U.undo) && !money) return { ...base, intent: 'undo', target: 'last' };
  if (has(U.create) && has(U.customer_nouns)) {
    const c = who();
    return c ? { ...base, intent: 'create_customer', name: c.name } : { ...base, intent: 'clarify', slot: 'customer', question: render(lang, 'clarify_customer') };
  }
  if (has(U.reminder)) {
    const c = who();
    if (c && c.ambiguous) return disambiguate(base, c, lang);
    return c ? { ...base, intent: 'reminder_optin', customer: cust(c) }
      : { ...base, intent: 'clarify', slot: 'customer', question: render(lang, 'clarify_customer') };
  }
  if (!money && (has(U.query) || toks.some((x) => x.t === '?'))) {
    const c = who();
    if (c && c.ambiguous) return disambiguate(base, c, lang);
    if (c) return { ...base, intent: 'query_balance', customer: cust(c) };
    const d = clauseDate(words, lang, today);
    if (d) {
      const direction = has(U.payment_verbs) ? 'payment' : has(U.credit_verbs) ? 'credit' : null;
      return { ...base, intent: 'query_day_total', date: d.date, direction };
    }
    return { ...base, intent: 'query_balance', customer: null }; // whole-shop receivable
  }
  return parseEntries(toks, base, lang, ctx, today, opts);
}

module.exports = { parse };
