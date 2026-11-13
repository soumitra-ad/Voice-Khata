'use strict';
// Gnani Timbre v3.0 TTS over WebSocket. The ONLY place TTS is called. Stock voices only, no cloning.
// Every URL, header, message and event name comes from .env.
// TODO: VERIFY FROM GNANI DOCS — none of the .env values below are confirmed.
const { createHash } = require('node:crypto');
const WebSocket = require('ws');

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const pathGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const jsonFill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => JSON.stringify(String(vars[k] ?? '')).slice(1, -1));

const CACHE_MAX = 200;
const cacheKey = (text, voice, lang) => createHash('sha256').update(`${voice}\u0000${lang}\u0000${text}`).digest('hex');

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
  constructor({ lang = 'hi', voice = env('GNANI_TTS_VOICE') } = {}) {
    this.lang = lang;
    this.voice = voice;
    this.cache = new Map();
    this.gen = 0;
  }

  // Yields PCM16 LE mono Buffers at this.sampleRate. Cached by hash(text, voice, lang).
  async *stream(text) {
    const key = cacheKey(text, this.voice, this.lang);
    const hit = this.cache.get(key);
    if (hit) { yield* hit; return; }
    const gen = ++this.gen;
    const chunks = [];
    for await (const c of this.synth(text)) {
      if (gen !== this.gen) return; // flushed: do not cache a partial utterance
      chunks.push(c);
      yield c;
    }
    if (gen !== this.gen) return;
    this.cache.set(key, chunks);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }

  // Barge-in: stop the current utterance immediately.
  flush() { this.gen++; this.cancel(); }
  cancel() {}
  connect() {}
  close() {}
}

class TimbreAdapter extends Base {
  constructor(opts) {
    super(opts);
    this.sampleRate = Number(env('GNANI_TTS_SAMPLE_RATE', '16000')); // TODO: VERIFY FROM GNANI DOCS
    this.ws = null;
    this.current = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return this.ready;
    const url = env('GNANI_TTS_WS_URL'); // TODO: VERIFY FROM GNANI DOCS
    if (!url) throw new Error('GNANI_TTS_WS_URL is not set. TODO: VERIFY FROM GNANI DOCS, or run with MOCK_VOICE=1');
    const headers = {};
    const authHeader = env('GNANI_AUTH_HEADER'); // TODO: VERIFY FROM GNANI DOCS
    if (authHeader) headers[authHeader] = env('GNANI_AUTH_VALUE', '{key}').replace('{key}', env('GNANI_API_KEY'));
    this.ws = new WebSocket(url, { headers });
    this.ready = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', (data, isBinary) => {
      const ch = this.current;
      if (!ch) return;
      if (isBinary) { ch.push(Buffer.from(data)); return; } // TODO: VERIFY FROM GNANI DOCS (binary PCM vs base64 JSON)
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      const audio = pathGet(msg, env('GNANI_TTS_AUDIO_FIELD', 'audio')); // TODO: VERIFY FROM GNANI DOCS
      if (typeof audio === 'string') ch.push(Buffer.from(audio, 'base64'));
      if (String(pathGet(msg, env('GNANI_TTS_EVENT_FIELD', 'type'))) === env('GNANI_TTS_END_EVENT')) { ch.close(); this.current = null; } // TODO: VERIFY FROM GNANI DOCS
    });
    this.ws.on('close', () => { if (this.current) this.current.close(); this.current = null; this.ws = null; });
    this.ws.on('error', () => {});
    return this.ready;
  }

  async *synth(text) {
    await this.connect();
    const ch = channel();
    this.current = ch;
    const tpl = env('GNANI_TTS_REQUEST_TEMPLATE'); // TODO: VERIFY FROM GNANI DOCS, e.g. a JSON with {text} {voice} {lang}
    if (!tpl) throw new Error('GNANI_TTS_REQUEST_TEMPLATE is not set. TODO: VERIFY FROM GNANI DOCS');
    this.ws.send(jsonFill(tpl, { text, voice: this.voice, lang: this.lang }));
    yield* ch;
  }

  cancel() {
    if (this.current) { this.current.close(); this.current = null; }
    const msg = env('GNANI_TTS_CANCEL_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS
    if (msg && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
  }

  close() { if (this.ws) this.ws.close(); }
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

module.exports = { createTimbre, TimbreAdapter, MockTimbre, cacheKey };
