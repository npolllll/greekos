/**
 * Incremental reader for one top-level string field of a JSON object that arrives in chunks
 * (schema-constrained LLM output streamed token by token). The reply field is generated first,
 * so the persona can start speaking before the rest of the object (stage, feedback) exists.
 */
export class JsonFieldStream {
  private buf = '';
  private start = -1; // index just after the opening quote of the field value
  private pos = 0; // next unread index inside the value
  private done = false;
  value = '';

  constructor(private field: string) {}

  /** Feed a chunk; returns the newly decoded characters of the field value ('' if none yet). */
  push(chunk: string): string {
    this.buf += chunk;
    if (this.done) return '';
    if (this.start < 0) {
      const m = new RegExp(`"${this.field}"\\s*:\\s*"`).exec(this.buf);
      if (!m) return '';
      this.start = m.index + m[0].length;
      this.pos = this.start;
    }
    let out = '';
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (c === '"') { this.done = true; this.pos++; break; }
      if (c !== '\\') { out += c; this.pos++; continue; }
      // Escape sequence: wait until it is complete.
      const n = this.buf[this.pos + 1];
      if (n === undefined) break;
      if (n === 'u') {
        const hex = this.buf.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        this.pos += 6;
        continue;
      }
      out += ({ n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[n] ?? n;
      this.pos += 2;
    }
    this.value += out;
    return out;
  }

  get complete(): boolean { return this.done; }
  get raw(): string { return this.buf; }
}

/**
 * Cuts finished sentences off a growing text. A sentence ends at . ! ? ; (Greek question mark) or …
 * followed by whitespace; the tail stays buffered until it is finished or the stream ends.
 */
export class SentenceCutter {
  private pending = '';

  push(text: string): string[] {
    this.pending += text;
    const out: string[] = [];
    const re = /[.!?;…·]+["»)]?\s+/gu;
    let last = 0;
    for (let m = re.exec(this.pending); m; m = re.exec(this.pending)) {
      const s = this.pending.slice(last, m.index + m[0].length).trim();
      // Very short fragments ("Ναι.") ride with the next sentence: fewer, more natural TTS calls.
      if (s.length >= 12 || /[;?]$/.test(s)) { out.push(s); last = m.index + m[0].length; }
    }
    this.pending = this.pending.slice(last);
    return out;
  }

  flush(): string[] {
    const s = this.pending.trim();
    this.pending = '';
    return s ? [s] : [];
  }
}
