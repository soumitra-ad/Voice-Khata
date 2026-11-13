'use strict';
// Dumb client: capture audio, play audio, display. No ledger logic here.
const $ = (id) => document.getElementById(id);
const RING_FRAMES = 18;      // 18 x 20 ms = 360 ms pre-roll (>= 350 ms)
const BARGE_FRAMES = 9;      // 9 x 20 ms = 180 ms of speech over agent audio
const BARGE_RMS = 0.02;

let ws, ctx, talking = false;
const ring = [];
let sources = [], nextT = 0, ttsRate = 16000, firstChunk = false, leftover = null, endTimer = null, loud = 0;
let customers = new Map();
let mock = false, captured = 0, sentFrames = 0;
const MOCK_HUD = 'TTFB: MOCK — not a real measurement';

const send = (o) => { if (ws && ws.readyState === 1) ws.send(typeof o === 'string' || o instanceof ArrayBuffer ? o : JSON.stringify(o)); };
const rupees = (p) => '₹' + (Math.abs(p) / 100).toLocaleString('en-IN');
const note = (t) => { $('note').textContent = t; };

function line(cls, text) {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text; // textContent: transcripts are never parsed as HTML
  $('log').appendChild(d); $('log').scrollTop = 1e9;
}

async function start() {
  $('start').hidden = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  await ctx.resume();
  try {
    await ctx.audioWorklet.addModule('worklet.js');
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const node = new AudioWorkletNode(ctx, 'mic');
    node.onprocessorerror = (e) => console.error('[capture] worklet error', e);
    const mute = ctx.createGain(); mute.gain.value = 0; // keeps the worklet pulled without echoing the mic
    ctx.createMediaStreamSource(media).connect(node).connect(mute).connect(ctx.destination);
    node.port.onmessage = (e) => onFrame(e.data);
    // Watchdog: a silent worklet would otherwise look like a working mic.
    setTimeout(() => { if (!captured) { console.error('[capture] no frames from the worklet after 2 s'); note('Mic is not producing audio.'); } }, 2000);
  } catch (err) {
    console.error('[capture]', err);
    note('Mic unavailable (' + err.message + '). Mock mode still works: hold the button.');
  }
  connect();
}

function onFrame({ pcm, rms }) {
  $('meter').firstChild.style.width = Math.min(100, rms * 400) + '%';
  if (++captured % 10 === 0) $('frames').textContent = 'mic frames ' + captured + ' · sent ' + sentFrames;
  if (!talking) { ring.push(pcm); if (ring.length > RING_FRAMES) ring.shift(); return; }
  send(pcm); sentFrames++;
  // Barge-in on >180 ms of speech while the agent is audible. Only while PTT is held, so agent echo cannot trigger it.
  if (sources.length && rms > BARGE_RMS) { if (++loud >= BARGE_FRAMES) { stopAudio(); send({ type: 'barge_in' }); loud = 0; } } else loud = 0;
}

function pttDown(e) {
  if (e) e.preventDefault();
  if (talking || !ws || ws.readyState !== 1) return;
  talking = true; loud = 0;
  $('ptt').classList.add('on');
  send({ type: 'ptt_down' });
  for (const f of ring.splice(0)) { send(f); sentFrames++; } // pre-roll: the first word is never clipped
}

function pttUp(e) {
  if (e) e.preventDefault();
  if (!talking) return;
  talking = false;
  $('ptt').classList.remove('on');
  send({ type: 'ptt_up', t: performance.now() }); // release IS the endpoint
}

function stopAudio() {
  for (const s of sources) { try { s.stop(); } catch (_) { /* already stopped */ } }
  sources = []; nextT = 0; leftover = null; clearTimeout(endTimer);
}

function playChunk(buf) {
  let b = new Uint8Array(buf);
  if (leftover) { const m = new Uint8Array(leftover.length + b.length); m.set(leftover); m.set(b, leftover.length); b = m; leftover = null; }
  if (b.length % 2) { leftover = b.slice(-1); b = b.slice(0, -1); }
  if (!b.length) return;
  const i16 = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  const ab = ctx.createBuffer(1, f.length, ttsRate);
  ab.copyToChannel(f, 0);
  const src = ctx.createBufferSource();
  src.buffer = ab; src.connect(ctx.destination);
  const t = Math.max(nextT, ctx.currentTime + 0.01);
  src.start(t);
  nextT = t + ab.duration;
  sources.push(src);
  src.onended = () => { sources = sources.filter((x) => x !== src); };
  if (firstChunk) { firstChunk = false; send({ type: 'play_start', t: performance.now() + (t - ctx.currentTime) * 1000 }); }
}

function renderLedger(m) {
  customers = new Map(m.customers.map((c) => [c.id, c]));
  const who = (id) => { const c = customers.get(id); return c ? (c.display !== c.name ? c.display + ' · ' + c.name : c.name) : '?'; };
  const fill = (ul, rows) => {
    ul.replaceChildren(...rows.map(([l, r, cls]) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = l;
      const b = document.createElement('span'); b.textContent = r; b.className = 'num ' + (cls || '');
      li.append(a, b); return li;
    }));
  };
  $('total').textContent = '· total due ' + rupees(m.totalPaise);
  fill($('customers'), [...m.customers].sort((a, b) => b.balancePaise - a.balancePaise)
    .map((c) => [who(c.id), c.balancePaise < 0 ? rupees(c.balancePaise) + ' advance' : rupees(c.balancePaise), c.balancePaise < 0 ? 'adv' : '']));
  fill($('entries'), m.entries.map((e) => [e.date + ' · ' + who(e.customerId) + ' · ' + (e.direction === 'credit' ? 'udhaar' : 'jama'),
    (e.direction === 'credit' ? '+' : '−') + rupees(e.paise)]));
  fill($('promises'), m.promises.map((p) => [(p.dueOn || '—') + ' · ' + who(p.customerId), rupees(p.paise)]));
}

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { send({ type: 'hello', lang: $('lang').value }); $('ptt').disabled = false; };
  ws.onclose = () => { $('ptt').disabled = true; note('Disconnected, retrying…'); setTimeout(connect, 1000); };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) { playChunk(ev.data); return; }
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case 'session':
        mock = m.mock;
        $('mode').textContent = m.mock ? 'MOCK voice (canned transcripts)' : 'Gnani Prisma + Timbre';
        if (mock) $('hud').textContent = MOCK_HUD;
        note(''); break;
      case 'state': $('state').textContent = m.state; break;
      case 'partial': $('partial').textContent = m.text; break;
      case 'final': $('partial').textContent = ''; line('u', m.text); break;
      case 'agent': line('a', m.text); break;
      case 'tts_start': ttsRate = m.sampleRate; firstChunk = true; leftover = null; clearTimeout(endTimer); break;
      case 'tts_end': endTimer = setTimeout(() => send({ type: 'play_end', gen: m.gen }), Math.max(0, (nextT - ctx.currentTime) * 1000)); break;
      case 'flush': stopAudio(); break;
      case 'ledger': renderLedger(m); break;
      case 'metrics': $('hud').textContent = mock ? MOCK_HUD + ' (n ' + m.n + ')' : 'TTFB p50 ' + m.p50 + 'ms · p95 ' + m.p95 + 'ms · n ' + m.n; break;
      default:
    }
  };
}

$('go').onclick = start;
const ptt = $('ptt');
ptt.addEventListener('pointerdown', (e) => { ptt.setPointerCapture(e.pointerId); pttDown(e); });
ptt.addEventListener('pointerup', pttUp);
ptt.addEventListener('pointercancel', pttUp);
ptt.addEventListener('contextmenu', (e) => e.preventDefault()); // Android long-press menu
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && e.target === document.body) pttDown(e); });
addEventListener('keyup', (e) => { if (e.code === 'Space' && e.target === document.body) pttUp(e); });
$('lang').onchange = () => send({ type: 'lang', lang: $('lang').value });
$('purge').onclick = async () => {
  if (!confirm('Delete ALL demo data (ledger and transcripts)? This cannot be undone.')) return;
  const r = await fetch('/purge', { method: 'POST', headers: { 'x-khata': '1' } });
  note(r.ok ? 'All demo data deleted.' : 'Delete failed.');
};
