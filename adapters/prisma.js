'use strict';
// Gnani Prisma v3.0 STT over WebSocket. The ONLY place STT is called.
// Every URL, header, message and event name comes from .env (see adapters/config.js).
// TODO: VERIFY FROM GNANI DOCS — protocol below follows docs.gnani.ai STT Realtime (checked 2026-11-13):
//   - settings (model, language_code, x-sample-rate, VAD) are connection HEADERS, fixed per connection
//   - audio = binary PCM16 mono frames of exactly 1024 bytes (32 ms at 16 kHz), at real-time cadence
//   - {"type":"commit"} closes the open utterance now; server replies speech_start / processing / transcript
//   - VAD may split one push-to-talk turn into several 'transcript' segments; we join them into ONE final
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { env, pathGet, fill, langCode, authHeaders, jsonHeaders } = require('./config');

class PrismaAdapter extends EventEmitter {
  constructor({ lang = 'hi' } = {}) {
    super();
    this._lang = lang;
    this.ws = null;
    this.closing = false;
    this.backoff = 500;
    this.control = [];                 // JSON control messages waiting for the socket to open
    this.frames = [];                  // fixed-size audio frames waiting to be paced out
    this.pending = Buffer.alloc(0);    // bytes not yet making a whole frame
    this.timer = null;
    this.frameBytes = Number(env('GNANI_STT_FRAME_BYTES', '1024')); // TODO: VERIFY FROM GNANI DOCS
    this.frameMs = Number(env('GNANI_STT_FRAME_MS', '32'));         // TODO: VERIFY FROM GNANI DOCS
    this.resetTurn();
  }

  resetTurn() {
    this.texts = []; this.speechOpen = 0; this.sawSpeechStart = false;
    this.ending = false; this.committed = false;
    clearTimeout(this.endTimer); clearTimeout(this.graceTimer);
  }

  // Headers are fixed per connection: a new language means a new connection.
  get lang() { return this._lang; }
  set lang(v) {
    if (v === this._lang) return;
    this._lang = v;
    if (this.ws) { const old = this.ws; this.ws = null; old.close(); this.connect(); }
  }

  isOpen() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  // Pre-warm at session start so the first utterance does not pay the handshake.
  connect() {
    if (this.ws) return;
    const url = env('GNANI_STT_WS_URL'); // TODO: VERIFY FROM GNANI DOCS
    if (!url) throw new Error('GNANI_STT_WS_URL is not set. TODO: VERIFY FROM GNANI DOCS, or run with MOCK_VOICE=1');
    const headers = { ...authHeaders(), ...jsonHeaders('GNANI_STT_HEADERS', { lang: langCode(this._lang) }) };
    const sock = new WebSocket(url, { headers });
    this.ws = sock;
    sock.on('open', () => {
      this.backoff = 500;
      for (const m of this.control.splice(0)) sock.send(m); // start message before any audio or commit
      this.emit('open');
      this.pump();
    });
    sock.on('message', (data, isBinary) => { if (this.ws === sock) this.onMessage(data, isBinary); });
    sock.on('error', (e) => this.emit('error', e));
    sock.on('close', (code, reason) => {
      this.emit('close', code, String(reason));
      if (this.ws !== sock) return; // an old socket we replaced on purpose
      this.ws = null;
      if (this.ending) this.finish(); // never leave a turn hanging
      if (this.closing) return;
      // Stay warm (idle timeout, 15-minute session cap), with backoff so a bad key does not hammer the API.
      setTimeout(() => { try { if (!this.closing) this.connect(); } catch (e) { this.emit('error', e); } }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30000);
    });
  }

  sendControl(msg) { if (this.isOpen()) this.ws.send(msg); else this.control.push(msg); }

  // Utterance start (push-to-talk pressed).
  start() {
    this.resetTurn();
    this.frames = []; this.pending = Buffer.alloc(0);
    this.connect();
    const msg = env('GNANI_STT_START_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS (none documented)
    if (msg) this.sendControl(fill(msg, { lang: langCode(this._lang) }));
  }

  // Client frames are 640 bytes / 20 ms; Prisma wants exactly frameBytes. Re-chunk, then pace.
  sendPcm(buf) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, buf]) : Buffer.from(buf);
    while (this.pending.length >= this.frameBytes) {
      this.frames.push(this.pending.subarray(0, this.frameBytes));
      this.pending = this.pending.subarray(this.frameBytes);
    }
    this.pump();
  }

  // One frame per frameMs (real-time cadence, as the docs require). The 350 ms pre-roll arrives as a burst,
  // so while more than 2 frames are queued we go at 2x until caught up, instead of delaying the endpoint.
  pump() {
    if (this.timer) return;
    const tick = () => {
      this.timer = null;
      if (!this.frames.length) return;
      if (!this.isOpen()) return; // resumes from the 'open' handler
      this.ws.send(this.frames.shift());
      this.timer = setTimeout(tick, this.frames.length > 2 ? this.frameMs / 2 : this.frameMs);
    };
    tick();
  }

  // Push-to-talk release IS the endpoint: send what is left at once, then commit. No silence wait.
  end() {
    if (this.pending.length) {
      const last = Buffer.alloc(this.frameBytes); // zero-pad the final partial frame
      this.pending.copy(last);
      this.frames.push(last);
      this.pending = Buffer.alloc(0);
    }
    this.ending = true;
    clearTimeout(this.timer); this.timer = null;
    const commit = () => {
      if (!this.ending || this.committed) return;
      for (const f of this.frames.splice(0)) this.ws.send(f);
      this.committed = true;
      const msg = env('GNANI_STT_END_MESSAGE'); // TODO: VERIFY FROM GNANI DOCS
      if (msg) this.ws.send(fill(msg, { lang: langCode(this._lang) }));
      // If every segment that started has already been transcribed, the commit closes nothing: finish soon.
      if (this.sawSpeechStart && this.speechOpen === 0) this.graceTimer = setTimeout(() => this.finish(), 200);
    };
    if (this.isOpen()) commit();
    else this.once('open', commit); // socket still connecting: commit as soon as it opens
    this.endTimer = setTimeout(() => this.finish(), Number(env('GNANI_STT_FINAL_TIMEOUT_MS', '2500')));
  }

  finish() {
    if (!this.ending) return;
    const text = this.texts.join(' ').replace(/\s+/g, ' ').trim();
    this.resetTurn();
    this.emit('final', text);
  }

  onMessage(data, isBinary) {
    this.emit('raw', data, isBinary);
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const kind = String(pathGet(msg, env('GNANI_STT_EVENT_FIELD', 'type'))); // TODO: VERIFY FROM GNANI DOCS
    const text = pathGet(msg, env('GNANI_STT_TEXT_FIELD', 'text'));          // TODO: VERIFY FROM GNANI DOCS
    if (kind === env('GNANI_STT_SPEECH_EVENT')) { this.sawSpeechStart = true; this.speechOpen++; return; } // TODO: VERIFY FROM GNANI DOCS
    if (kind === env('GNANI_STT_ERROR_EVENT')) {                                                         // TODO: VERIFY FROM GNANI DOCS
      this.emit('error', new Error(`prisma: ${msg.message || 'error'}`));
      if (this.ending) this.finish();
      return;
    }
    if (kind === env('GNANI_STT_FINAL_EVENT') && typeof text === 'string') {                             // TODO: VERIFY FROM GNANI DOCS
      if (text.trim()) this.texts.push(text.trim());
      this.speechOpen = Math.max(0, this.speechOpen - 1);
      if (this.ending && this.committed) { this.finish(); return; } // the commit closed the last segment
      if (this.ending || this.texts.length) this.emit('partial', this.texts.join(' ')); // mid-turn VAD split
      return;
    }
    if (kind === env('GNANI_STT_PARTIAL_EVENT') && typeof text === 'string') this.emit('partial', [...this.texts, text].join(' ').trim());
  }

  close() {
    this.closing = true;
    clearTimeout(this.timer); clearTimeout(this.endTimer); clearTimeout(this.graceTimer);
    if (this.ws) this.ws.close();
  }
}

// MOCK_VOICE=1: canned transcripts, no network. The full loop works with zero API access.
// The demo roster has TWO Rameshes (gali wala, station wala), so "रमेश ..." is ambiguous and the agent asks
// "कौन से रमेश?" — answered with just the tag. Exercises disambiguation, correction, commit and a query.
const FIXTURES = [
  'रमेश का 340 रुपये उधार कल 200 दिया था।', // real Prisma v3.0 output style: digits, no comma -> disambiguate
  'gali wala',                          // -> read-back
  'नाही, 430',                          // -> corrected read-back
  'हाँ',                                // -> commit
  'रमेश का टोटल?',                      // -> disambiguate
  'गली वाला',                           // -> balance
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
