'use strict';
// npm run probe -- ./sample.wav [--lang hi]      Prisma STT
// npm run probe -- --tts "नमस्ते" [--lang hi]       Timbre TTS -> tts-probe.wav
// Streams a WAV to Gnani Prisma using .env config and prints EVERY raw WebSocket event verbatim,
// then the final transcript and which script it came back in (digits / Devanagari / Bengali / Latin).
// Always uses the REAL adapter, whatever MOCK_VOICE says.
try { process.loadEnvFile(); } catch { /* use the shell environment */ }
const fs = require('node:fs');
const { PrismaAdapter } = require('../adapters/prisma');

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const lang = arg('--lang') || 'hi';
const ttsText = arg('--tts');
const file = ttsText === undefined ? process.argv[2] : null;
if (!file && ttsText === undefined) { console.error('usage: npm run probe -- ./sample.wav [--lang hi|mr|bn|en]\n       npm run probe -- --tts "text" [--lang hi]'); process.exit(2); }
if (!process.env.GNANI_API_KEY) { console.error('GNANI_API_KEY is empty in .env'); process.exit(2); }

if (ttsText !== undefined) {
  // Timbre: stream one reply, print every raw message (audio truncated), save playable WAV.
  const { TimbreAdapter } = require('../adapters/timbre');
  const WebSocket = require('ws');
  const t = new TimbreAdapter({ lang, script: 'native' });
  const t0 = Date.now();
  const origOn = WebSocket.prototype.on;
  WebSocket.prototype.on = function (ev, fn) { // tap raw messages without changing the adapter
    if (ev === 'message') return origOn.call(this, ev, (d, bin) => {
      const txt = bin ? `binary ${d.length} bytes` : String(d).replace(/"audio":"[^"]{40,}"/, (m) => m.slice(0, 50) + '…"');
      console.log(`[+${String(Date.now() - t0).padStart(6)} ms] RAW ${txt}`);
      fn(d, bin);
    });
    return origOn.call(this, ev, fn);
  };
  (async () => {
    console.log(`# url: ${process.env.GNANI_TTS_WS_URL}  voice: ${t.voice}  lang: ${lang}`);
    const chunks = [];
    let first = null;
    try {
      for await (const c of t.stream(ttsText)) { if (first === null) first = Date.now() - t0; chunks.push(c); }
    } catch (e) { console.error('ERROR', e.message); }
    t.close();
    const pcm = Buffer.concat(chunks);
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(t.sampleRate, 24);
    hdr.writeUInt32LE(t.sampleRate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync('tts-probe.wav', Buffer.concat([hdr, pcm]));
    console.log(`\n# first audio after ${first} ms; ${chunks.length} chunks, ${(pcm.length / (t.sampleRate * 2)).toFixed(2)} s of audio -> tts-probe.wav`);
    setTimeout(() => process.exit(0), 100);
  })();
  return;
}

// Minimal WAV reader: 16-bit PCM or 32-bit float, any rate/channels -> 16 kHz mono Int16.
function readWav(path) {
  const b = fs.readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const isFloat = fmt.format === 3 || (fmt.format === 0xfffe && fmt.bits === 32);
  if (!(fmt.bits === 16 && !isFloat) && !(fmt.bits === 32 && isFloat)) throw new Error(`unsupported WAV: ${fmt.bits}-bit format ${fmt.format}`);
  const step = (fmt.bits / 8) * fmt.channels, n = Math.floor(data.length / step);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = i * step + c * (fmt.bits / 8);
      s += isFloat ? data.readFloatLE(o) : data.readInt16LE(o) / 32768;
    }
    mono[i] = s / fmt.channels;
  }
  const ratio = fmt.rate / 16000, outN = Math.floor(n / ratio), out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) { // linear interpolation resample
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    const v = Math.max(-1, Math.min(1, mono[i0] * (1 - f) + (mono[Math.min(n - 1, i0 + 1)] || 0) * f));
    out.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  return { pcm: out, fmt };
}

const { pcm, fmt } = readWav(file);
console.log(`# ${file}: ${fmt.rate} Hz, ${fmt.channels} ch, ${fmt.bits}-bit -> 16000 Hz mono Int16, ${(pcm.length / 32000).toFixed(2)} s`);
console.log(`# url: ${process.env.GNANI_STT_WS_URL || '(GNANI_STT_WS_URL not set)'}  lang: ${lang}`);

const t0 = Date.now();
const stamp = () => `[+${String(Date.now() - t0).padStart(6)} ms]`;
const p = new PrismaAdapter({ lang });
let final = null, lastMsg = Date.now();

p.on('raw', (data, isBinary) => {
  lastMsg = Date.now();
  console.log(`${stamp()} RAW ${isBinary ? `binary ${data.length} bytes: ${Buffer.from(data).subarray(0, 32).toString('hex')}…` : String(data)}`);
});
p.on('partial', (t) => console.log(`${stamp()} -> parsed as PARTIAL: ${t}`));
p.on('final', (t) => { final = t; console.log(`${stamp()} -> parsed as FINAL: ${t}`); });
p.on('open', () => console.log(`${stamp()} OPEN`));
p.on('close', (code, reason) => console.log(`${stamp()} CLOSE ${code} ${reason}`));
p.on('error', (e) => console.log(`${stamp()} ERROR ${e.message}`));

function classify(t) {
  return [/\d/.test(t) && 'ASCII digits', /[०-९]/.test(t) && 'Devanagari digits', /[ऀ-ॿ]/.test(t) && 'Devanagari script',
    /[ঀ-৿]/.test(t) && 'Bengali script', /[A-Za-z]/.test(t) && 'Latin letters'].filter(Boolean).join(', ') || 'none of the above';
}

async function main() {
  try { p.start(); } catch (e) { console.error(e.message); process.exit(1); }
  for (let o = 0; o < pcm.length; o += 640) { // real-time pacing, 20 ms frames
    p.sendPcm(pcm.subarray(o, o + 640));
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log(`${stamp()} sent all audio; sending end-of-utterance`);
  p.end();
  // Wait for a final, or 5 s of silence from the server, max 20 s.
  while (!final && Date.now() - lastMsg < 5000 && Date.now() - t0 < 20000 + pcm.length / 32) await new Promise((r) => setTimeout(r, 100));
  p.close();
  console.log('\n# FINAL TRANSCRIPT:', final === null ? '(none parsed — check GNANI_STT_* event/text field settings against the RAW lines above)' : final);
  if (final !== null) console.log('# contains:', classify(final));
  setTimeout(() => process.exit(0), 200);
}
main();
