'use client';
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SayButton } from '@/components/SayButton';
import { Icon } from '@/components/Icon';
import type { Letter, Digraph } from '@/lib/alphabet/reference';

type Drill = { kind: 'case' | 'name'; target: Letter; options: Letter[] };

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/**
 * Interactive alphabet board: 24 tiles → detail with real (ASR-screened) synthesized audio of the
 * letter name and lesson words; digraph cards; and a short warm-up drill. The drill is practice only:
 * it writes nothing and never counts as evidence of mastery (that happens in the lesson's tasks).
 */
export function AlphabetBoard({ unitId, letters, digraphs }: { unitId: string; letters: Letter[]; digraphs: Digraph[] }) {
  const reduce = useReducedMotion();
  const [sel, setSel] = useState<Letter>(letters[0]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const detailRef = useRef<HTMLDivElement>(null);
  const vowels = useMemo(() => new Set(['α', 'ε', 'η', 'ι', 'ο', 'υ', 'ω']), []);

  function nextDrill(kind: Drill['kind']) {
    const target = letters[Math.floor(Math.random() * letters.length)];
    const options = shuffle([target, ...shuffle(letters.filter((l) => l.lower !== target.lower)).slice(0, 3)]);
    setDrill({ kind, target, options });
    setPicked(null);
  }
  function pick(l: Letter) {
    if (!drill || picked) return;
    setPicked(l.lower);
    setScore((s) => ({ right: s.right + (l.lower === drill.target.lower ? 1 : 0), total: s.total + 1 }));
  }

  return (
    <div className="stack">
      <div className="alpha-layout">
        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="alpha" /> 24 буквы</div><span className="tiny quiet"><span className="alpha-key vowel" /> гласные · <span className="alpha-key" /> согласные</span></div>
          <div className="alpha-grid" role="listbox" aria-label="Буквы греческого алфавита">
            {letters.map((l) => (
              <button key={l.lower} type="button" role="option" aria-selected={sel.lower === l.lower} className={`alpha-tile ${vowels.has(l.lower) ? 'vowel' : ''} ${sel.lower === l.lower ? 'on' : ''}`} onClick={() => { setSel(l); if (window.matchMedia('(max-width: 980px)').matches) detailRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }} lang="el" aria-label={`${l.upper} ${l.lower}, ${l.name}`}>
                <span className="alpha-pair">{l.upper}<small>{l.lower}{l.final ? ` ${l.final}` : ''}</small></span>
                <span className="alpha-name">{l.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card cardpad alpha-detail" aria-live="polite" ref={detailRef}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sel.lower} initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={reduce ? undefined : { opacity: 0, y: -6, filter: 'blur(3px)' }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <div className="alpha-hero" lang="el"><span>{sel.upper}</span><span>{sel.lower}</span>{sel.final ? <span title="Конечная форма — в конце слова">{sel.final}</span> : null}</div>
              <div className="row between" style={{ marginTop: 6 }}>
                <div><div className="eyebrow">Название</div><div className="display" lang="el" style={{ fontSize: 26 }}>{sel.name}</div></div>
                <SayButton unitId={unitId} text={sel.name} />
              </div>
              <div className="alpha-fact">
                <div className="eyebrow">Звук в слове</div>
                {sel.sound ? <p><b className="mono" style={{ fontSize: 17 }}>{sel.sound}</b> <span className="small quiet">— так сказано в уроке. Название буквы ≠ её звук.</span></p> : <p className="small quiet">Урок не описывает этот звук словами: опирайтесь на образец и слова ниже{['θ', 'δ', 'χ', 'γ'].includes(sel.lower) ? '; θ, δ, χ, γ отрабатываются отдельно' : ''}.</p>}
                {sel.final ? <p className="small">В конце слова пишется <b lang="el">{sel.final}</b>: <span lang="el">μέσα — κόσμος</span>. Это одна буква, а не два звука.</p> : null}
              </div>
              <div className="eyebrow" style={{ marginTop: 14 }}>Слова из урока</div>
              {sel.examples.length ? sel.examples.map((w) => (
                <div key={w} className="real-line" style={{ padding: '6px 0' }}><SayButton unitId={unitId} text={w} small /><strong lang="el" className="display" style={{ fontSize: 18, fontWeight: 500 }}>{w}</strong></div>
              )) : <p className="small quiet">В уроке нет отдельного слова с этой буквой — она встретится в следующих уроках.</p>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="card cardpad">
        <div className="card-title"><Icon name="layers" /> Сочетания, которые читаются как один звук</div>
        <div className="digraph-grid stagger">
          {digraphs.map((d) => (
            <div key={d.key} className="digraph">
              <div className="row between"><span className="display" lang="el" style={{ fontSize: 24 }}>{d.letters}</span><span className="mono small">{d.sound}</span></div>
              <p className="small quiet" style={{ margin: '6px 0 8px' }}>{d.note_ru}</p>
              {d.examples.map((w) => <div key={w} className="real-line" style={{ padding: '4px 0' }}><SayButton unitId={unitId} text={w} small /><span lang="el" className="display" style={{ fontSize: 16.5 }}>{w}</span></div>)}
            </div>
          ))}
        </div>
      </div>

      <div className="card cardpad">
        <div className="card-top"><div className="card-title"><Icon name="target" /> Разминка</div>{score.total ? <span className="mono small">{score.right} / {score.total}</span> : null}</div>
        <p className="small quiet">Быстрая самопроверка. Ничего не записывает и не влияет на освоение — для этого есть задания урока.</p>
        <div className="row">
          <button className="btn small" type="button" onClick={() => nextDrill('case')}>Найди строчную</button>
          <button className="btn small outline" type="button" onClick={() => nextDrill('name')}>Найди по названию</button>
        </div>
        {drill ? (
          <div className="drill">
            <div className="drill-q" lang="el">{drill.kind === 'case' ? drill.target.upper : drill.target.name}</div>
            <div className="drill-opts">
              {drill.options.map((o) => {
                const state = !picked ? '' : o.lower === drill.target.lower ? 'right' : o.lower === picked ? 'wrong' : 'dim';
                return <button key={o.lower} type="button" lang="el" className={`drill-opt ${state}`} onClick={() => pick(o)} disabled={!!picked}>{o.lower}</button>;
              })}
            </div>
            {picked ? (
              <div className="row between" role="status">
                <span className="small">{picked === drill.target.lower ? 'Верно.' : <>Это <b lang="el">{drill.target.upper} {drill.target.lower}</b> — {drill.target.name}.</>}</span>
                <button className="btn small outline" type="button" onClick={() => nextDrill(drill.kind)}>Ещё <Icon name="arrow" size={14} /></button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
