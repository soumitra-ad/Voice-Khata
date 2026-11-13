'use strict';
// Gnani Timbre v3.0 TTS over WebSocket. The ONLY place TTS is called. Stock voices only, no cloning.
// Every URL, header, message and event name comes from .env (see adapters/config.js).
// TODO: VERIFY FROM GNANI DOCS — protocol below follows docs.gnani.ai TTS Realtime (checked 2026-11-13):
//   - key in the upgrade header; one JSON request at a time: {text, voice, model, language, audio_config}
//   - replies: {type:"start"}, {type:"audio", data:{audio:<base64>}}..., {type:"complete"} or {type:"error"}
//   - no documented cancel message, so barge-in closes the socket (a stale reply must never leak into the next)
//   - observed live (npm run probe -- --tts): a reply ends with TWO 'complete' messages, the second carrying the
//     request_id from 'start'; messages for an already-finished request_id are ignored so they cannot end the next reply
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { env, pathGet, jsonFill, langCode, authHeaders } = require('./config');

// One cache for the whole process: a phrase synthesised for one session is instant for the next.
// The key MUST include script: the same reply in Devanagari and in Latin is different audio.
const CACHE_MAX = 500;
const TTS_CACHE = new Map();
const cacheKey = (text, voice, lang, script) => createHash('sha256').update([voice, lang, script, text].join('\u0000')).digest('hex');

// Tiny push->pull queue so callers can `for await` audio chunks as they stream in.
function channel() {
  const items = [];
  let wake = null, done = false;
  return {
    push(x) { items.push(x); if (wake) { wake(); wake = null; } },
    close() { done = true; if (wake) { wake(); wake = null; } },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length) { yield items.shift(); continue; }
        if (done) return;
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

class Base {
  constructor({ lang = 'hi', voice = env('GNANI_TTS_VOICE'), script = 'native' } = {}) {
    this.lang = lang;
    this.voice = voice;
    this.script = script;
    this.flushGen = 0; // bumped only by flush(), so concurrent streams never cancel each other
  }

  key(text) { return cacheKey(text, this.voice, this.lang, this.script); }

  // Yields PCM16 LE mono Buffers at this.sampleRate. Cached by hash(text, voice, lang, script).
  async *stream(text) {
    const key = this.key(text);
    const hit = TTS_CACHE.get(key);
    if (hit) { TTS_CACHE.delete(key); TTS_CACHE.set(key, hit); yield* hit; return; }
    const gen = this.flushGen;
    const chunks = [];
    for await (const c of this.synth(text)) {
      if (gen !== this.flushGen) return; // flushed: do not cache a partial utterance
      chunks.push(c);
      yield c;
    }
    if (gen !== this.flushGen) return;
    TTS_CACHE.set(key, chunks);
    if (TTS_CACHE.size > CACHE_MAX) TTS_CACHE.delete(TTS_CACHE.keys().next().value);
  }

  // Fill the cache for phrases we will certainly say. Sequential, so it never floods the TTS socket.
  async prewarm(texts) {
    for (const t of texts) {
      if (TTS_CACHE.has(this.key(t))) continue;
      for await (const _ of this.stream(t)) { /* drain into the cache */ } // eslint-disable-line no-unused-vars
    }
  }

  // Barge-in: stop the current utterance immediately.
  flush() { this.flushGen++; this.cancel(); }
  cancel() {}
  connect() {}
  close() {}
}

class TimbreAdapter extends Base {
  constructor(opts) {
    super(opts);
    this.sampleRate = Number(env('GNANI_TTS_SAMPLE_RATE', '16000')); // TODO: VERIFY FROM GNANI DOCS (must match audio_config)
    this.ws = null;
    this.current = null;
    this.finished = new Set(); // request_ids whose reply already ended
  }

  connect() {
    if (this.ws) return this.ready;
    const url = env('GNANI_TTS_WS_URL'); // TODO: VERIFY FROM GNANI DOCS
    if (!url) throw new Error('GNANI_TTS_WS_URL is not set. TODO: VERIFY FROM GNANI DOCS, or run with MOCK_VOICE=1');
    const sock = new WebSocket(url, { headers: authHeaders() });
    this.ws = sock;
    this.ready = new Promise((resolve, reject) => { sock.once('open', resolve); sock.once('error', reject); });
    this.ready.catch(() => {}); // surfaced by synth(); avoid an unhandled rejection for pre-warm
    sock.on('message', (data, isBinary) => {
      if (this.ws !== sock) return;
      const ch = this.current;
      if (!ch) return;
      if (isBinary) { ch.push(Buffer.from(data)); return; } // raw PCM, if the server ever sends binary
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const rid = pathGet(msg, env('GNANI_TTS_REQUEST_ID_FIELD', 'request_id')); // TODO: VERIFY FROM GNANI DOCS
      if (rid && this.finished.has(rid)) return; // late message from a reply that already ended
      if (rid && !ch.requestId) ch.requestId = rid;
      const kind = String(pathGet(msg, env('GNANI_TTS_EVENT_FIELD', 'type')));  // TODO: VERIFY FROM GNANI DOCS
      const audio = pathGet(msg, env('GNANI_TTS_AUDIO_FIELD', 'audio'));        // TODO: VERIFY FROM GNANI DOCS
      if (typeof audio === 'string' && audio) ch.push(Buffer.from(audio, 'base64'));
      if (kind === env('GNANI_TTS_ERROR_EVENT')) console.error('[timbre]', msg.message || 'error'); // TODO: VERIFY FROM GNANI DOCS
      if (kind === env('GNANI_TTS_END_EVENT') || kind === env('GNANI_TTS_ERROR_EVENT')) {
        if (ch.requestId) { this.finished.add(ch.requestId); if (this.finished.size > 100) this.finished.delete(this.finished.values().next().value); }
        ch.close(); this.current = null;
      }
    });
    sock.on('close', () => {
      if (this.ws !== sock) return;
      if (this.current) this.current.close(); // a reply cut short by the server ends, it never hangs
      this.current = null; this.ws = null;
    });
    sock.on('error', () => {});
    return this.ready;
  }

  async *synth(text) {
    await this.connect();
    const ch = channel();
    this.current = ch;
    const tpl = env('GNANI_TTS_REQUEST_TEMPLATE'); // TODO: VERIFY FROM GNANI DOCS
    if (!tpl) throw new Error('GNANI_TTS_REQUEST_TEMPLATE is not set. TODO: VERIFY FROM GNANI DOCS');
    this.ws.send(jsonFill(tpl, { text, voice: this.voice, lang: langCode(this.lang) }));
    yield* ch;
  }

  // Barge-in. With a documented cancel message we send it; without one we drop the socket, because the
  // rest of the cancelled reply would otherwise arrive and be played as the start of the next reply.
  cancel() {
    if (!this.current) return;
    this.current.close(); this.current = null;
    const msg = env('GNANI_TTS_CANCEL_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS (none documented)
    if (msg && this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(msg); return; }
    if (this.ws) { const old = this.ws; this.ws = null; old.close(); }
  }

  close() { if (this.ws) { const old = this.ws; this.ws = null; old.close(); } }
}

// MOCK_VOICE=1: a short beep, streamed in 20 ms chunks. No network.
class MockTimbre extends Base {
  constructor(opts) { super(opts); this.sampleRate = 16000; }

  async *synth() {
    const n = this.sampleRate * 0.25, frame = 320;
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const env2 = Math.min(1, i / 160, (n - i) / 160); // 10 ms fade in/out, no clicks
      pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 880 * i) / this.sampleRate) * 6000 * env2), i * 2);
    }
    for (let o = 0; o < pcm.length; o += frame * 2) {
      yield pcm.subarray(o, o + frame * 2);
      await new Promise((r) => setImmediate(r));
    }
  }
}

const createTimbre = (opts) => (process.env.MOCK_VOICE === '0' ? new TimbreAdapter(opts) : new MockTimbre(opts));

module.exports = { createTimbre, TimbreAdapter, MockTimbre, cacheKey, TTS_CACHE };
