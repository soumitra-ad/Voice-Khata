// Mic capture: any input rate -> 16 kHz mono Int16, 20 ms frames (320 samples = 640 bytes).
// No per-frame PCM allocation: frames come from a pool of ArrayBuffers that are TRANSFERRED to the main thread
// and transferred back after sending. Sample [320] carries the frame RMS (x32767), so no wrapper object is posted.
const FRAME = 320, BYTES = (FRAME + 1) * 2;

class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; // 48000 -> 3, 44100 -> 2.75625
    this.pos = 0; this.acc = 0; this.cnt = 0; this.n = 0; this.sq = 0;
    this.pool = [];
    for (let i = 0; i < 32; i++) this.pool.push(new Int16Array(BYTES / 2)); // > 18 pre-roll + in flight
    this.port.onmessage = (e) => { if (e.data instanceof ArrayBuffer && e.data.byteLength === BYTES) this.pool.push(new Int16Array(e.data)); };
    this.frame = this.next();
  }

  next() { return this.pool.pop() || new Int16Array(BYTES / 2); } // allocates only if the pool ran dry

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos < this.ratio) continue;
      this.pos -= this.ratio;
      // Box-average the samples of this output slot: a cheap anti-alias low-pass before decimating.
      const v = Math.max(-1, Math.min(1, this.acc / this.cnt));
      this.acc = 0; this.cnt = 0;
      this.frame[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.sq += v * v;
      if (this.n === FRAME) {
        this.frame[FRAME] = Math.round(Math.sqrt(this.sq / FRAME) * 32767);
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = this.next(); this.n = 0; this.sq = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic', Mic);
