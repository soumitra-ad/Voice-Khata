'use strict';
// WebSocket server + per-client session state machine. Joins core/ (pure logic) and adapters/ (Gnani).
try { process.loadEnvFile(); } catch { /* no .env: defaults below */ }

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { parse } = require('./core/parser');
const { openLedger, speakBalance } = require('./core/ledger');
const { SecureStore, purge: purgeTranscripts } = require('./core/securestore');
const { aiDisclosure } = require('./core/guardrails');
const { render, dayWord } = require('./core/langpacks');
const { answerPending, pendingFrom, questionFor } = require('./core/dialog');
const { toWords, tokenize } = require('./core/numerals');
const { canonicalKey } = require('./core/translit');
const { createPrisma } = require('./adapters/prisma');
const { createTimbre } = require('./adapters/timbre');

const PORT = Number(process.env.PORT || 3000);
const MOCK = process.env.MOCK_VOICE !== '0';
const LANGS = new Set(['hi', 'mr', 'bn', 'en']);
// Script for spoken AND on-screen agent text. User transcripts are never converted.
const SCRIPT = process.env.TTS_SCRIPT === 'latin' ? 'latin' : 'native';

let key = process.env.TRANSCRIPT_KEY;
if (!key) {
  // Still encrypted at rest; transcripts just become unreadable after a restart. Set TRANSCRIPT_KEY to keep them.
  key = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] TRANSCRIPT_KEY not set: using an in-memory key for this run.');
}
const ledger = openLedger(process.env.LEDGER_DB || './khata.db');
const store = new SecureStore(ledger.db, key);

// Every user-facing string comes from core/langpacks.js in the configured script.
const T = (s, key, vars) => render(s.lang, key, vars, SCRIPT);
const W = (s, paise) => toWords(paise, s.lang, SCRIPT);
const nativeAlias = (c) => c && (c.aliases || []).find((x) => /[^\x00-\x7F]/.test(x));
// Name to speak/show: the original-script name in native mode when we have one.
function nm(c) {
  if (!c || SCRIPT !== 'native') return c ? c.name : '';
  if (c.display) return c.display;
  const row = c.id && ledger.findCustomers('').find((x) => x.id === c.id);
  return nativeAlias(row) || c.name;
}
const nmById = (id) => nm(ledger.findCustomers('').find((c) => c.id === id));
const balanceLine = (s, id, c) => speakBalance(ledger.balancePaise(id), s.lang, c ? nm(c) : nmById(id), SCRIPT);

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const signed = (e) => (e.direction === 'credit' ? e.paise : -e.paise);
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

// ---------- ledger helpers ----------
function findCustomerId(c) {
  if (c.id) return c.id;
  const k = canonicalKey(c.name);
  const hit = ledger.findCustomers('').find((x) => [x.name, ...x.aliases].some((n) => canonicalKey(n) === k));
  return hit ? hit.id : null;
}
// Created only on commit. The original-script name is kept as an alias for display and matching.
const ensureCustomer = (c) => findCustomerId(c) || ledger.addCustomer(c.name, c.display ? [c.display] : []);

function snapshot() {
  const customers = ledger.findCustomers('').map((c) => ({
    id: c.id, name: c.name, display: c.aliases.find((a) => /[^\x00-\x7F]/.test(a)) || c.name, balancePaise: ledger.balancePaise(c.id),
  }));
  const entries = ledger.db.prepare(`SELECT e.id, e.customer_id, e.direction, e.amount_paise, e.entry_date FROM entries e
    WHERE e.undone = 0 ORDER BY e.id DESC LIMIT 20`).all().map((r) => ({
    id: r.id, customerId: r.customer_id, direction: r.direction, paise: Number(r.amount_paise), date: r.entry_date }));
  const promises = ledger.db.prepare("SELECT id, customer_id, amount_paise, due_on FROM promises WHERE status = 'open' ORDER BY id DESC")
    .all().map((r) => ({ id: r.id, customerId: r.customer_id, paise: Number(r.amount_paise), dueOn: r.due_on }));
  return { type: 'ledger', customers, entries, promises, totalPaise: ledger.totalReceivablePaise() };
}

// ---------- sessions ----------
const sessions = new Set();

function newSession(ws) {
  return {
    id: crypto.randomUUID(), ws, lang: 'hi', state: 'IDLE',
    prisma: null, timbre: null,
    lastIntent: null,      // last intent carrying entries (for corrections)
    pendingEntries: [],    // read back, waiting for "haan"
    pendingPromises: [],
    lastCommit: null,      // { ids } of the last committed batch
    pendingQuestion: null, // the agent's open question; a short answer ("gali wala", "pehla") completes it
    lastCustomer: null,
    openPromise: null,
    playQueue: [],         // agent utterances not yet spoken (barge-in clears it)
    speakGen: 0, speaking: '', streaming: false, speculative: null,
    metrics: { turn: null, ttfb: [] },
    lastTranscriptId: null,
  };
}

const send = (s, obj) => { if (s.ws.readyState === 1) s.ws.send(JSON.stringify(obj)); };
const setState = (s, state) => { s.state = state; send(s, { type: 'state', state }); };
const mark = (s, k) => { if (s.metrics.turn && s.metrics.turn[k] == null) s.metrics.turn[k] = Date.now() - s.metrics.turn.t0; };

function wireAdapters(s) {
  s.prisma = createPrisma({ lang: s.lang });
  s.timbre = createTimbre({ lang: s.lang });
  s.prisma.on('partial', (text) => onPartial(s, text));
  s.prisma.on('final', (text) => onFinal(s, text));
  s.prisma.on('error', (e) => console.error('[prisma]', e.message));
  // Pre-warm both sockets at session start.
  try { s.prisma.connect(); } catch (e) { console.error('[prisma]', e.message); }
  try { Promise.resolve(s.timbre.connect()).catch((e) => console.error('[timbre]', e.message)); } catch (e) { console.error('[timbre]', e.message); }
}

// ---------- speaking ----------
// s.speaking = text the user can still HEAR: set at tts_start, cleared by the client's play_end (same gen) or barge-in.
async function speak(s, text) {
  s.playQueue.push(text);
  if (s.streaming) return; // queued behind the current utterance
  s.streaming = true;
  while (s.playQueue.length) {
    const t = s.playQueue.shift();
    const gen = ++s.speakGen;
    s.speaking = t;
    setState(s, 'SPEAKING');
    store.put(JSON.stringify({ role: 'agent', text: t, at: new Date().toISOString() }));
    send(s, { type: 'agent', text: t });
    send(s, { type: 'tts_start', gen, sampleRate: s.timbre.sampleRate });
    try {
      for await (const chunk of s.timbre.stream(t)) {
        if (gen !== s.speakGen) break;
        mark(s, 'tts_first_byte');
        if (s.ws.readyState === 1) s.ws.send(chunk);
      }
    } catch (e) { console.error('[timbre]', e.message); }
    if (gen !== s.speakGen) break; // barged in
    send(s, { type: 'tts_end', gen });
  }
  s.streaming = false;
}

function bargeIn(s, why) {
  if (!s.speaking) return;
  s.speakGen++;
  s.playQueue = [];
  s.speaking = '';
  s.timbre.flush();
  send(s, { type: 'flush', why });
  setState(s, 'LISTENING'); // lastIntent / pendingEntries are kept
}

// ---------- turn handling ----------
function onPartial(s, text) {
  send(s, { type: 'partial', text });
  const toks = tokenize(text).map((t) => t.t).filter((t) => /\p{L}|\d/u.test(t));
  // Self-echo guard: a partial made only of words the agent is currently saying is not barge-in.
  const echo = s.speaking && toks.every((t) => tokenize(s.speaking).some((x) => x.t === t));
  if (toks.length >= 1 && !echo) bargeIn(s, 'partial');
  // Speculative parse: no side effects, reused if the final matches.
  try { s.speculative = { text, intent: parse(text, ctxFor(s)) }; } catch { s.speculative = null; }
}

function ctxFor(s) {
  let openPromise = s.openPromise;
  if (!openPromise && s.lastCustomer && s.lastCustomer.id) {
    const p = ledger.openPromises(s.lastCustomer.id).pop();
    if (p) openPromise = { id: p.id, customer: s.lastCustomer, paise: p.paise, due_on: p.dueOn };
  }
  return { lang: s.lang, today: today(), customers: ledger.findCustomers(''), lastIntent: s.lastIntent, lastCustomer: s.lastCustomer, openPromise };
}

function onFinal(s, text) {
  mark(s, 'stt_final');
  setState(s, 'THINKING');
  s.lastTranscriptId = store.put(JSON.stringify({ role: 'user', text, at: new Date().toISOString() }));
  send(s, { type: 'final', text }); // original script, never transliterated
  let reply;
  try { reply = handle(s, text); } catch (e) { console.error('[turn]', e); reply = T(s, 'error'); }
  mark(s, 'intent_done');
  speak(s, reply);
}

function interpret(s, text) {
  const ctx = ctxFor(s);
  const pending = s.pendingQuestion;
  s.pendingQuestion = null;
  const answered = answerPending(pending, text, ctx); // "gali wala" / "pehla" / "340 wala" -> completed intent
  if (answered) { s.speculative = null; return answered; }
  const spec = s.speculative && s.speculative.text === text ? s.speculative.intent : null;
  s.speculative = null;
  return spec || parse(text, ctx);
}

function readback(s) {
  const lang = s.lang, t = today();
  const parts = s.pendingEntries.map((e) => {
    const phrase = T(s, e.direction === 'credit' ? 'entry_credit' : 'entry_payment', { name: nm(e.customer), amount: W(s, e.paise) });
    return e.date === addDays(t, -1) ? `${T(s, 'yesterday')} ${phrase}` : phrase;
  });
  const byCustomer = new Map();
  for (const e of s.pendingEntries) byCustomer.set(e.customer.name, e.customer);
  const balances = [...byCustomer.values()].map((c) => {
    const id = findCustomerId(c);
    const mine = s.pendingEntries.filter((e) => e.customer.name === c.name);
    const prov = id ? ledger.provisionalBalance(id, mine.map((e) => ({ customerId: id, direction: e.direction, paise: e.paise })))
      : mine.reduce((a, e) => a + signed(e), 0);
    return speakBalance(prov, lang, nm(c), SCRIPT);
  });
  return [parts.join(', ') + T(s, 'stop'), balances.join(' '), T(s, 'confirm_q')].join(' ');
}

function commit(s) {
  const rows = s.pendingEntries.map((e) => ({ customerId: ensureCustomer(e.customer), direction: e.direction, paise: e.paise, date: e.date }));
  const ids = ledger.addEntries(rows, { transcriptId: s.lastTranscriptId }); // one atomic transaction
  for (const p of s.pendingPromises) ledger.addPromise({ customerId: ensureCustomer(p.customer), paise: p.paise, dueOn: p.due_on }, { transcriptId: s.lastTranscriptId });
  mark(s, 'commit');
  s.lastCommit = { ids, rows };
  s.lastCustomer = { id: rows[rows.length - 1].customerId, name: s.pendingEntries[s.pendingEntries.length - 1].customer.name };
  s.lastIntent = { ...s.lastIntent, entries: s.pendingEntries.map((e, i) => ({ ...e, customer: { ...e.customer, id: rows[i].customerId } })) };
  const names = [...new Set(rows.map((r) => r.customerId))];
  s.pendingEntries = [];
  s.pendingPromises = [];
  broadcastLedger();
  return [T(s, 'saved'), ...names.map((id) => balanceLine(s, id))].join(' ');
}

function handle(s, text) {
  const intent = interpret(s, text);
  const lang = s.lang;
  send(s, { type: 'intent', intent: intent.intent });
  if (intent.customer && intent.customer.name) s.lastCustomer = { ...intent.customer, id: findCustomerId(intent.customer) };

  switch (intent.intent) {
    case 'add_entries':
      s.pendingEntries = intent.entries;
      s.pendingPromises = intent.promises || [];
      s.lastIntent = intent;
      s.lastCustomer = { ...intent.entries[0].customer, id: findCustomerId(intent.entries[0].customer) };
      return readback(s);

    case 'confirm':
      return s.pendingEntries.length ? commit(s) : T(s, 'nothing');

    case 'deny':
      if (!s.pendingEntries.length) return T(s, 'nothing');
      s.pendingEntries = [];
      s.pendingPromises = [];
      return T(s, 'cancelled');

    case 'correct_slot': {
      if (s.pendingEntries.length) { // before "haan": patch and read back again
        s.pendingEntries = intent.patched.entries;
        s.lastIntent = intent.patched;
        return readback(s);
      }
      if (!s.lastCommit) return T(s, 'nothing');
      // After commit: soft-delete + re-insert in the ledger.
      const patch = { amount: { paise: intent.value }, direction: { direction: intent.value }, date: { date: intent.value } }[intent.slot]
        || (intent.slot === 'customer' ? { customerId: ensureCustomer(intent.value) } : {});
      const idxs = intent.entryIndex == null ? s.lastCommit.ids.map((_, i) => i) : [intent.entryIndex];
      for (const i of idxs) s.lastCommit.ids[i] = ledger.correctEntry(s.lastCommit.ids[i], patch, { transcriptId: s.lastTranscriptId });
      mark(s, 'commit');
      s.lastIntent = intent.patched;
      broadcastLedger();
      const cid = ledger.db.prepare('SELECT customer_id FROM entries WHERE id = ?').get(s.lastCommit.ids[idxs[0]]).customer_id;
      return [T(s, 'saved'), balanceLine(s, cid)].join(' ');
    }

    case 'query_balance': {
      if (!intent.customer) return T(s, 'total', { amount: W(s, ledger.totalReceivablePaise()) });
      const id = findCustomerId(intent.customer);
      return speakBalance(id ? ledger.balancePaise(id) : 0, lang, nm({ ...intent.customer, id }), SCRIPT);
    }

    case 'query_day_total':
      return T(s, 'day_total', { when: dayWord(lang, dayDiff(intent.date, today()), SCRIPT) || intent.date,
        credit: W(s, ledger.dayTotalPaise(intent.date, 'credit')), payment: W(s, ledger.dayTotalPaise(intent.date, 'payment')) });

    case 'undo':
      if (!s.lastCommit) return T(s, 'nothing');
      for (const id of s.lastCommit.ids) ledger.undoEntry(id, { transcriptId: s.lastTranscriptId });
      s.lastCommit = null;
      broadcastLedger();
      return T(s, 'undone');

    case 'create_customer':
      ensureCustomer({ name: intent.name });
      broadcastLedger();
      return T(s, 'created', { name: intent.name });

    case 'reminder_optin':
      ledger.setReminderOptIn(ensureCustomer(intent.customer), true);
      return T(s, 'optin', { name: nm(intent.customer) });

    case 'promise_note': { // a note, not money: saved straight away, balance untouched
      const p = intent.promise, customerId = ensureCustomer(p.customer);
      const id = ledger.addPromise({ customerId, paise: p.paise, dueOn: p.due_on }, { transcriptId: s.lastTranscriptId });
      mark(s, 'commit');
      s.openPromise = { id, customer: { ...p.customer, id: customerId }, paise: p.paise, due_on: p.due_on };
      s.lastCustomer = s.openPromise.customer;
      broadcastLedger();
      return T(s, 'promise_saved', { when: p.due_on ? dayWord(lang, dayDiff(p.due_on, today()), SCRIPT) || p.due_on : '', amount: W(s, p.paise) });
    }

    case 'promise_fulfil': {
      const p = intent.promise;
      if (!p.id) return T(s, 'nothing');
      ledger.fulfilPromise(p.id, { date: intent.entry.date, paise: intent.entry.paise }, { transcriptId: s.lastTranscriptId });
      mark(s, 'commit');
      s.openPromise = null;
      broadcastLedger();
      return [T(s, 'saved'), balanceLine(s, p.customer.id, p.customer)].join(' ');
    }

    case 'clarify':
    case 'disambiguate':
      s.pendingQuestion = pendingFrom(intent, text, s.lastIntent);
      return questionFor(intent, { lang, script: SCRIPT, customers: ledger.findCustomers(''), lastIntent: s.lastIntent, nameOf: nm });

    case 'refuse':
      return T(s, intent.reason === 'lending' ? 'refused_lending' : 'refused_diagnosis');

    default:
      return T(s, 'error');
  }
}

function broadcastLedger() {
  const snap = snapshot();
  for (const s of sessions) send(s, snap);
}

function sendMetrics(s) {
  const xs = s.metrics.ttfb;
  send(s, { type: 'metrics', p50: pct(xs, 0.5), p95: pct(xs, 0.95), n: xs.length, last: s.metrics.turn });
}

// ---------- http + ws ----------
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// "Delete all demo data": transcripts and ledger. Custom header blocks cross-site form posts.
app.post('/purge', (req, res) => {
  if (req.get('x-khata') !== '1') return res.status(403).json({ ok: false });
  purgeTranscripts(ledger.db);
  ledger.purge();
  for (const s of sessions) Object.assign(s, { lastIntent: null, pendingEntries: [], pendingPromises: [], lastCommit: null, pendingQuestion: null, lastCustomer: null, openPromise: null });
  broadcastLedger();
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });

wss.on('connection', (ws) => {
  const s = newSession(ws);
  sessions.add(s);
  ws.on('message', (data, isBinary) => {
    if (isBinary) { if (s.state === 'LISTENING') s.prisma.sendPcm(data); return; }
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    switch (m.type) {
      case 'hello':
        if (LANGS.has(m.lang)) s.lang = m.lang;
        wireAdapters(s);
        send(s, { type: 'session', id: s.id, lang: s.lang, mock: MOCK, script: SCRIPT });
        send(s, snapshot());
        speak(s, aiDisclosure(s.lang, SCRIPT).safeReply); // the literal first agent turn, before any task
        break;
      case 'lang':
        if (!LANGS.has(m.lang) || m.lang === s.lang) break;
        s.lang = m.lang;
        s.prisma.lang = s.timbre.lang = m.lang;
        speak(s, aiDisclosure(s.lang, SCRIPT).safeReply); // new language: disclose again in it
        break;
      case 'ptt_down':
        s.metrics.turn = { t0: null, speech_end: null };
        s.speculative = null;
        s.prisma.start();
        setState(s, 'LISTENING'); // agent audio keeps playing until barge-in (speech >180 ms or a partial)
        break;
      case 'ptt_up': // release IS the endpoint: no silence wait
        if (!s.metrics.turn) break;
        s.metrics.turn.t0 = Date.now();
        s.metrics.turn.speech_end = m.t;
        setState(s, 'THINKING');
        s.prisma.end();
        break;
      case 'barge_in':
        bargeIn(s, 'speech');
        break;
      case 'play_start': {
        const t = s.metrics.turn;
        if (t && t.speech_end != null && t.play_start == null) {
          t.play_start = m.t;
          t.ttfb = Math.round(m.t - t.speech_end); // TTFB = play_start - speech_end (both client clock)
          s.metrics.ttfb.push(t.ttfb);
          if (s.metrics.ttfb.length > 50) s.metrics.ttfb.shift();
          console.log(JSON.stringify({ session: s.id.slice(0, 8), ...t }));
          sendMetrics(s);
        }
        break;
      }
      case 'play_end':
        if (m.gen !== s.speakGen) break; // a stale utterance finished
        s.speaking = '';
        if (s.state === 'SPEAKING') setState(s, 'IDLE');
        break;
      default:
    }
  });
  ws.on('close', () => {
    sessions.delete(s);
    if (s.prisma) s.prisma.close();
    if (s.timbre) s.timbre.close();
  });
});

server.listen(PORT, () => console.log(`Voice Khata on http://localhost:${PORT}  (MOCK_VOICE=${MOCK ? 1 : 0})`));
