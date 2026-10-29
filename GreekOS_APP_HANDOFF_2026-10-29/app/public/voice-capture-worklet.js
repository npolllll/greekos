/**
 * GreekOS microphone capture: mono input at the context rate → 16 kHz PCM16 in 40 ms packets.
 * Anti-aliased by averaging each output sample's input window (rate ratio is fractional).
 * Also reports the RMS level of every packet so the UI meter follows the real signal.
 */
class GreekosCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.target = o.targetRate || 16000;
    this.packet = o.packetSamples || 640;
    this.ratio = sampleRate / this.target;
    this.pos = 0;         // fractional read position inside `acc`
    this.acc = [];        // pending input samples
    this.out = new Int16Array(this.packet);
    this.n = 0;
    this.sumSq = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this.acc.push(ch[i]);
    while (this.pos + this.ratio <= this.acc.length) {
      const a = Math.floor(this.pos);
      const b = Math.min(this.acc.length, Math.floor(this.pos + this.ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += this.acc[j];
      const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.sumSq += v * v;
      this.pos += this.ratio;
      if (this.n === this.packet) {
        const rms = Math.sqrt(this.sumSq / this.packet);
        const buf = this.out.slice().buffer;
        this.port.postMessage({ pcm: buf, rms }, [buf]);
        this.n = 0;
        this.sumSq = 0;
      }
    }
    const drop = Math.floor(this.pos);
    if (drop > 0) { this.acc.splice(0, drop); this.pos -= drop; }
    return true;
  }
}
registerProcessor('greekos-capture', GreekosCapture);
