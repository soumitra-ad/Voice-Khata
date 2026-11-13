// Mic capture: any input rate -> 16 kHz mono Int16, posted as 20 ms frames (320 samples = 640 bytes) with their RMS.
class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; // 48000 -> 3, 44100 -> 2.75625
    this.pos = 0; this.acc = 0; this.cnt = 0;
    this.frame = new Int16Array(320); this.n = 0; this.sq = 0;
  }

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
      if (this.n === 320) {
        this.port.postMessage({ pcm: this.frame.buffer, rms: Math.sqrt(this.sq / 320) }, [this.frame.buffer]);
        this.frame = new Int16Array(320); this.n = 0; this.sq = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic', Mic);
