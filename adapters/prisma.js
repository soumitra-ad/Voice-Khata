'use strict';
// Gnani Prisma v3.0 STT over WebSocket. The ONLY place STT is called.
// Every URL, header, message and event name comes from .env.
// TODO: VERIFY FROM GNANI DOCS — none of the .env values below are confirmed; run `npm run probe -- ./sample.wav`.
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const pathGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));
const langCode = (lang) => {
  const map = Object.fromEntries(env('GNANI_LANG_MAP').split(',').filter(Boolean).map((p) => p.split(':'))); // TODO: VERIFY FROM GNANI DOCS
  return map[lang] || lang;
};

class PrismaAdapter extends EventEmitter {
  constructor({ lang = 'hi' } = {}) {
    super();
    this.lang = lang;
    this.ws = null;
    this.queue = [];      // frames sent before the socket opened (keeps the pre-roll)
    this.closing = false;
  }

  // Pre-warm at session start so the first utterance does not pay the handshake.
  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const url = env('GNANI_STT_WS_URL'); // TODO: VERIFY FROM GNANI DOCS
    if (!url) throw new Error('GNANI_STT_WS_URL is not set. TODO: VERIFY FROM GNANI DOCS, or run with MOCK_VOICE=1');
    const headers = {};
    const authHeader = env('GNANI_AUTH_HEADER'); // TODO: VERIFY FROM GNANI DOCS (header name)
    if (authHeader) headers[authHeader] = fill(env('GNANI_AUTH_VALUE', '{key}'), { key: env('GNANI_API_KEY') }); // TODO: VERIFY FROM GNANI DOCS
    this.ws = new WebSocket(url, { headers });
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => {
      this.emit('open');
      for (const m of this.queue.splice(0)) this.ws.send(m);
    });
    this.ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    this.ws.on('error', (e) => this.emit('error', e));
    this.ws.on('close', (code, reason) => {
      this.emit('close', code, String(reason));
      this.ws = null;
      if (!this.closing) setTimeout(() => { try { this.connect(); } catch (e) { this.emit('error', e); } }, 500); // stay warm
    });
  }

  send(m) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(m); else this.queue.push(m);
  }

  // Utterance boundaries. Messages are templates from .env with {lang} placeholder.
  start() {
    this.connect();
    const msg = env('GNANI_STT_START_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS
    if (msg) this.send(fill(msg, { lang: langCode(this.lang) }));
  }

  sendPcm(buf) { this.send(buf); } // 16 kHz mono Int16 LE, 20 ms frames. TODO: VERIFY FROM GNANI DOCS (format)

  end() {
    const msg = env('GNANI_STT_END_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS
    if (msg) this.send(fill(msg, { lang: langCode(this.lang) }));
  }

  onMessage(data, isBinary) {
    this.emit('raw', data, isBinary);
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const kind = pathGet(msg, env('GNANI_STT_EVENT_FIELD', 'type'));     // TODO: VERIFY FROM GNANI DOCS
    const text = pathGet(msg, env('GNANI_STT_TEXT_FIELD', 'text'));      // TODO: VERIFY FROM GNANI DOCS
    if (typeof text !== 'string') return;
    if (String(kind) === env('GNANI_STT_FINAL_EVENT')) this.emit('final', text);          // TODO: VERIFY FROM GNANI DOCS
    else if (String(kind) === env('GNANI_STT_PARTIAL_EVENT')) this.emit('partial', text); // TODO: VERIFY FROM GNANI DOCS
  }

  close() { this.closing = true; if (this.ws) this.ws.close(); }
}

// MOCK_VOICE=1: canned transcripts, no network. The full loop works with zero API access.
const FIXTURES = [
  'रमेश का 340 उधार, कल 200 दिया था',
  'नाही, 430',
  'हाँ',
  'रमेश का टोटल?',
];

class MockPrisma extends EventEmitter {
  constructor({ lang = 'hi', fixtures = FIXTURES } = {}) {
    super();
    this.lang = lang;
    this.fixtures = fixtures;
    this.i = 0;
    this.frames = 0;
  }

  connect() {}
  current() { return this.fixtures[this.i % this.fixtures.length]; }
  start() { this.frames = 0; }

  // One more word of the canned utterance every 200 ms of audio, like a streaming recogniser.
  sendPcm() {
    this.frames++;
    if (this.frames % 10 === 0) {
      const words = this.current().split(' ');
      this.emit('partial', words.slice(0, Math.min(words.length, this.frames / 10)).join(' '));
    }
  }

  end() {
    const text = this.current();
    this.i++;
    setImmediate(() => this.emit('final', text));
  }

  close() {}
}

const createPrisma = (opts) => (process.env.MOCK_VOICE === '0' ? new PrismaAdapter(opts) : new MockPrisma(opts));

module.exports = { createPrisma, PrismaAdapter, MockPrisma, FIXTURES };
