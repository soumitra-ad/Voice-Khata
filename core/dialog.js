'use strict';
// Follow-up turns: the agent asked a question, the user answers with just a tag ("gali wala", "station",
// "pehla", "340 wala"). Pure and deterministic. The server holds the pending question; this resolves it.
const { parse } = require('./parser');
const { tokenize, findAmounts } = require('./numerals');
const { UNION: U, render, lexWord } = require('./langpacks');
const { canonicalKey } = require('./translit');

const ORDINALS = ['first', 'second', 'third'];
const rupees = (paise) => String(paise / 100);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const aliasList = (c) => [c.name, ...(Array.isArray(c.aliases) ? c.aliases : String(c.aliases || '').split(','))].filter(Boolean);

// Answer words, transliterated and resolved to lexicon words (वाला -> vala, पहला -> pahla).
const answerWords = (text) => tokenize(text).map((t) => lexWord(t.t) || t.t).filter((w) => /[\p{L}\d]/u.test(w));
const ordinalOf = (words) => ORDINALS.findIndex((f) => words.some((w) => U[f].has(w)));
const NOISE = (w) => U.wala.has(w) || U.possessive.has(w) || U.filler.has(w) || U.yes.has(w);

function fullCustomer(c, customers) { return (customers || []).find((x) => x.id === c.id) || c; }
const keySet = (c) => new Set(aliasList(c).flatMap((n) => tokenize(n).map((t) => canonicalKey(t.t))));

// Which candidate does a short tag name? Ordinal, or a word that only one candidate's name/aliases contain.
function pickCandidate(answer, candidates, customers) {
  const words = answerWords(answer);
  const ord = ordinalOf(words);
  if (ord >= 0) return candidates[ord] || null;
  const sets = candidates.map((c) => keySet(fullCustomer(c, customers)));
  const shared = sets.reduce((a, s) => new Set([...a].filter((k) => s.has(k))));
  const keys = words.filter((w) => !NOISE(w)).map(canonicalKey).filter((k) => !shared.has(k));
  const scores = sets.map((s) => keys.filter((k) => s.has(k)).length);
  const best = Math.max(...scores);
  return best > 0 && scores.filter((x) => x === best).length === 1 ? candidates[scores.indexOf(best)] : null;
}

// Which entry does "pehla" / "340 wala" / "kal wala" / "udhaar wala" name? Returns an index or -1.
function pickEntry(answer, entries, today) {
  const words = answerWords(answer);
  const ord = ordinalOf(words);
  if (ord >= 0) return ord < entries.length ? ord : -1;
  let idx = entries.map((_, i) => i);
  const amt = findAmounts(answer).find((r) => r.kind === 'money');
  if (amt) idx = idx.filter((i) => entries[i].paise === amt.paise);
  if (words.some((w) => U.credit_verbs.has(w))) idx = idx.filter((i) => entries[i].direction === 'credit');
  if (words.some((w) => U.payment_verbs.has(w))) idx = idx.filter((i) => entries[i].direction === 'payment');
  if (words.some((w) => U.kal.has(w) || U.yesterday.has(w))) idx = idx.filter((i) => entries[i].date === addDays(today, -1));
  if (words.some((w) => U.today.has(w))) idx = idx.filter((i) => entries[i].date === today);
  const narrowed = amt || words.some((w) => !NOISE(w));
  return narrowed && idx.length === 1 ? idx[0] : -1;
}

// The pending question to hold on the session for an intent, or null.
function pendingFrom(intent, text, lastIntent) {
  if (intent.intent === 'disambiguate') return { kind: 'disambiguate', text, candidates: intent.candidates };
  if (intent.intent === 'clarify' && intent.slot === 'correction_target' && lastIntent) return { kind: 'correction_target', text, lastIntent };
  if (intent.intent === 'clarify' && intent.slot === 'direction' && intent.pending) return { kind: 'direction', text, pending: intent.pending };
  return null;
}

/**
 * Resolve a short answer against the pending question. Returns the completed intent, or null when the
 * answer is not an answer (the caller then parses it as a fresh utterance). Never needs the sentence repeated.
 * ctx: the parser ctx ({ lang, today, customers, ... }).
 */
function answerPending(pending, text, ctx) {
  if (!pending) return null;
  if (pending.kind === 'disambiguate') {
    const c = pickCandidate(text, pending.candidates, ctx.customers);
    if (!c) return null;
    // Re-read the original sentence with the other candidates out of the roster: now it is unambiguous.
    const others = new Set(pending.candidates.filter((x) => x.id !== c.id).map((x) => x.id));
    const r = parse(pending.text, { ...ctx, customers: (ctx.customers || []).filter((x) => !others.has(x.id)) });
    return r.intent === 'disambiguate' ? null : r;
  }
  if (pending.kind === 'correction_target') {
    const ents = pending.lastIntent.entries;
    const i = pickEntry(text, ents, ctx.today);
    if (i < 0) return null;
    // Re-run the original correction against just the chosen entry, then splice it back.
    const r = parse(pending.text, { ...ctx, lastIntent: { ...pending.lastIntent, entries: [ents[i]] } });
    if (r.intent !== 'correct_slot') return null;
    const patched = JSON.parse(JSON.stringify(pending.lastIntent));
    patched.entries[i] = r.patched.entries[0];
    return { ...r, entryIndex: i, patched };
  }
  if (pending.kind === 'direction') {
    // "Ramesh 200" -> "Ramesh ne diya" / "ko diya": keep the amount, take the direction from the answer.
    if (findAmounts(text).some((r) => r.kind === 'money')) return null; // a new amount = a new utterance
    const { customer, paise } = pending.pending;
    const first = canonicalKey(customer.name.split(' ')[0]);
    const named = tokenize(text).some((t) => canonicalKey(t.t).startsWith(first));
    const r = parse(`${named ? '' : customer.name} ${text} ${rupees(paise)}`, ctx);
    return r.intent === 'add_entries' ? r : null;
  }
  return null;
}

// Short tag that tells candidates apart: an alias or name word the others do not share.
function candidateLabel(c, all, customers) {
  const sets = all.map((x) => keySet(fullCustomer(x, customers)));
  const shared = sets.reduce((a, s) => new Set([...a].filter((k) => s.has(k))));
  const full = fullCustomer(c, customers);
  return aliasList(full).find((n) => tokenize(n).some((t) => !shared.has(canonicalKey(t.t)))) || full.name;
}

/**
 * The spoken question for a clarify / disambiguate intent, in the requested script.
 * opts: { lang, script, customers, lastIntent, nameOf(customer) -> display name }
 */
function questionFor(intent, { lang, script = 'latin', customers = [], lastIntent = null, nameOf = (c) => c.name }) {
  const T = (key, vars) => render(lang, key, vars, script);
  if (intent.intent === 'disambiguate') {
    const labels = intent.candidates.map((c) => candidateLabel(c, intent.candidates, customers));
    const name = intent.candidates.length ? nameOf(fullCustomer(intent.candidates[0], customers)).split(' ')[0] : '';
    return T('disambiguate', { name, options: labels.join(` ${T('target_join')} `) });
  }
  switch (intent.slot) {
    case 'direction': return T('clarify_direction', { name: nameOf(intent.pending.customer) });
    case 'amount': return T('clarify_amount');
    case 'customer': return T('clarify_customer');
    case 'tense': return T('clarify_future_credit');
    case 'correction_target': {
      const ents = (lastIntent && lastIntent.entries) || intent.entries || [];
      return T('clarify_target', { options: ents.map((e) => T('target_option', { amount: rupees(e.paise) })).join(` ${T('target_join')} `) });
    }
    default: return T('clarify_repeat');
  }
}

module.exports = { answerPending, pendingFrom, pickCandidate, pickEntry, questionFor, candidateLabel };
