/**
 * One long-lived hunspell process in pipe mode (ispell protocol, `hunspell -a`), shared by the corpus
 * QA, the Greek guard of the persona's replies and the course grammar rules. Starting hunspell loads the
 * whole el_GR dictionary (≈ 0.6 s); a live turn checks every sentence, so the process stays up and
 * answers are cached. Requests are serialised; if the pipe fails, callers fall back to a one-shot run.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Pending = { words: string[]; resolve: (known: boolean[]) => void; reject: (e: Error) => void; results: boolean[] };

class HunspellPipe {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private ready: Promise<void> | null = null;
  private current: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private dict: string) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn('hunspell', ['-a', '-i', 'UTF-8', '-d', this.dict], { env: { ...process.env, LANG: 'C.UTF-8' } });
      this.child = child;
      let banner = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        this.buf += chunk;
        if (!banner) {
          const nl = this.buf.indexOf('\n');
          if (nl < 0) return;
          this.buf = this.buf.slice(nl + 1);
          banner = true;
          resolve();
        }
        this.drain();
      });
      const fail = (e: Error) => { this.current?.reject(e); this.current = null; this.child = null; this.ready = null; reject(e); };
      child.on('error', fail);
      child.on('exit', () => fail(new Error('hunspell exited')));
      child.stdin.on('error', fail);
    });
    return this.ready;
  }

  /** One result block per word: a status line, then an empty line. */
  private drain() {
    const p = this.current;
    if (!p) return;
    for (;;) {
      const end = this.buf.indexOf('\n\n');
      if (end < 0) return;
      const block = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      const c = block.trimStart()[0];
      p.results.push(c === '*' || c === '+' || c === '-');
      if (p.results.length === p.words.length) { this.current = null; p.resolve(p.results); return; }
    }
  }

  check(words: string[]): Promise<boolean[]> {
    const run = async () => {
      await this.start();
      return new Promise<boolean[]>((resolve, reject) => {
        this.current = { words, resolve, reject, results: [] };
        // «^» makes hunspell read the line as text, never as a command.
        this.child!.stdin.write(words.map((w) => `^${w.replace(/\s+/g, '')}\n`).join(''));
      });
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

const pipes = new Map<string, HunspellPipe>();
const cache = new Map<string, boolean>();

/** Which of the words the dictionary knows (cached; null when the pipe cannot run). */
export async function knownWords(dict: string, words: string[]): Promise<Map<string, boolean> | null> {
  const out = new Map<string, boolean>();
  const missing: string[] = [];
  for (const w of new Set(words)) {
    // A line without letters yields no result block in the ispell protocol: never send one.
    if (!/\p{L}/u.test(w)) { out.set(w, true); continue; }
    const c = cache.get(w);
    if (c === undefined) missing.push(w); else out.set(w, c);
  }
  if (missing.length) {
    let pipe = pipes.get(dict);
    if (!pipe) { pipe = new HunspellPipe(dict); pipes.set(dict, pipe); }
    try {
      const res = await pipe.check(missing);
      missing.forEach((w, i) => { out.set(w, res[i]); if (cache.size < 200_000) cache.set(w, res[i]); });
    } catch {
      pipes.delete(dict);
      return null;
    }
  }
  return out;
}
