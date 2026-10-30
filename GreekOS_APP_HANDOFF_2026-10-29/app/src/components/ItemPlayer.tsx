'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemDTO } from '@/lib/content/dto';
import { Icon } from './Icon';
import { ContextCoach } from './ContextCoach';
import { AudioPlayer } from './AudioPlayer';
import { AnimatePresence, motion } from 'motion/react';

/** Learner-facing names of corpus item types (raw type codes are never shown). */
const ITEM_TYPE_RU: Record<string, string> = {
  short_answer: 'краткий ответ', open_response: 'развёрнутый ответ', mcq: 'выбор ответа', multiple_choice: 'выбор ответа', multiple_assignment: 'соответствие',
  matching: 'соответствие', extra_word: 'лишнее слово', response: 'ответ', retention: 'повторение', meaning_in_context: 'значение в контексте',
  register_switch: 'смена регистра', production: 'своими словами', error_correction: 'исправление ошибки', reading_reference: 'чтение: к чему относится',
  reading_inference: 'чтение: вывод', reading_detail: 'чтение: деталь', D28_transfer: 'перенос (D28)', D7_recall: 'вспомнить (D7)',
  spoken_interaction: 'устный диалог', ordering: 'порядок', writing_transfer: 'письмо: перенос',
};

export interface AttemptResultClient {
  attempt_id: string;
  verdict: string;
  reliable: boolean;
  scorer: string;
  feedback_ru: string;
  error_kind: string | null;
  ai: { used: boolean; confidence: string | null; dimensions: Array<{ criterion_id: string; label_ru: string; level: string; note_ru: string }>; improved_el: string | null; errors: Array<{ quote: string; correction_el: string; explanation_ru: string }> } | null;
  reveal: { key: string[]; model_response: string | null } | null;
  explanation_ru?: string | null;
  feedback_event_id: string | null;
  review: { outcome: string; interval_days: number } | null;
  scheduled_reviews: string[];
  mastery_counted: boolean;
  preview: boolean;
  replayed?: boolean;
}

const VERDICT_UI: Record<string, { cls: string; title: string }> = {
  CORRECT: { cls: 'good', title: 'Верно' },
  ACCEPTABLE_VARIANT: { cls: 'variant', title: 'Допустимый вариант' },
  INCORRECT_CONFIRMED: { cls: 'bad', title: 'Есть ошибка' },
  PENDING_REVIEW: { cls: 'pending', title: 'Ответ отправлен на проверку' },
  AMBIGUOUS: { cls: 'pending', title: 'Не удалось однозначно прочитать ответ' },
  ABSTAIN: { cls: 'pending', title: 'Автоматическая проверка воздержалась' },
  NOT_ASSESSED: { cls: 'pending', title: 'Не оценивается' },
  UNSUPPORTED: { cls: 'pending', title: 'Тип задания не поддерживается' },
};

const LEVEL_RU: Record<string, string> = { met: 'выполнено', partial: 'частично', not_met: 'не выполнено', not_assessable: 'не оценивается по тексту' };

function isGreek(s: string) {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.filter((c) => /[Ͱ-Ͽἀ-῿]/u.test(c)).length / letters.length > 0.5;
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ItemPlayer(props: {
  item: ItemDTO;
  context: string;
  contextRef?: string;
  preview?: boolean;
  feedbackEventId?: string;
  allowContext?: boolean;
  compact?: boolean;
  onResult?: (r: AttemptResultClient) => void;
}) {
  const { item } = props;
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AttemptResultClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [netFail, setNetFail] = useState(false);
  const [assistance, setAssistance] = useState<'none' | 'retry_after_model'>('none');
  const [showContext, setShowContext] = useState(false);
  const [appeal, setAppeal] = useState<'idle' | 'open' | 'sent'>('idle');
  const [appealText, setAppealText] = useState('');
  const keyRef = useRef<string>(newKey());
  const startedAt = useRef<number>(0);
  const audioBlocked = item.requires_audio && item.audio?.status !== 'available';
  const words = useMemo(() => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length, [text]);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);


  async function submit() {
    setError(null);
    if (item.response_kind === 'choice' && choice === null) return setError('Выберите вариант.');
    if (item.response_kind !== 'choice' && !text.trim()) return setError('Пустой ответ не засчитывается.');
    setBusy(true);
    setNetFail(false);
    try {
      const res = await fetch('/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item_id: item.item_id, content_hash: item.content_hash,
          response: item.response_kind === 'choice' ? { choice, ...(text.trim() ? { text } : {}) } : { text },
          assistance, context: props.preview ? 'preview' : props.context, context_ref: props.contextRef,
          feedback_event_id: props.feedbackEventId, response_source: 'typed',
          active_ms: Math.min(3_600_000, Date.now() - startedAt.current), idempotency_key: keyRef.current,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message ?? 'Ответ не принят.');
        if (json.error === 'CONTENT_CHANGED') router.refresh();
        return;
      }
      setResult(json as AttemptResultClient);
      props.onResult?.(json as AttemptResultClient);
      router.refresh();
    } catch {
      // Same idempotency key on retry: the server records the fact once.
      setNetFail(true);
      setError('Нет связи с сервером. Ответ не потерян — нажмите «Повторить отправку».');
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    keyRef.current = newKey();
    startedAt.current = Date.now();
    setAssistance('retry_after_model');
    setResult(null);
    setShowContext(false);
    setChoice(null);
  }

  async function sendAppeal() {
    if (!result || appealText.trim().length < 3) return;
    const res = await fetch('/api/appeals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: result.attempt_id, reason_ru: appealText.trim() }) });
    if (res.ok) setAppeal('sent');
    else setError((await res.json().catch(() => ({}))).message ?? 'Не удалось отправить.');
  }

  const v = result ? VERDICT_UI[result.verdict] ?? VERDICT_UI.PENDING_REVIEW : null;
  const locked = !!result || busy;

  return (
    <div className={`card player ${props.preview ? 'watermark' : ''}`}>
      <div className="row between">
        <span className="tag gray">{[item.level, ITEM_TYPE_RU[item.type] ?? 'задание'].filter(Boolean).join(' · ')}</span>
        {props.preview ? null : <span className="tiny muted">{item.item_id}</span>}
      </div>
      <div className={`player-prompt ${isGreek(item.prompt) ? 'greek' : ''}`} lang={isGreek(item.prompt) ? 'el' : 'ru'}>{item.prompt}</div>

      {item.stimulus?.kind === 'inline' || item.stimulus?.kind === 'text' ? (
        <div className="stimulus" lang="el" tabIndex={0} aria-label="Текст задания">
          {item.stimulus.title ? <b>{item.stimulus.title}{'\n'}</b> : null}
          {item.stimulus.segments?.length ? item.stimulus.segments.map((s) => `(${s.label}) ${s.text}`).join('\n\n') : item.stimulus.text}
          {item.stimulus.focus ? <div className="bank">{Object.entries(item.stimulus.focus).map(([k, val]) => <span key={k}>Фокус: {k === 'gap' ? `пропуск (${val})` : k === 'target_segment' ? `сегмент (${val})` : `${k} ${val}`}</span>)}</div> : null}
          {item.stimulus.example ? <div className="bank"><span>Пример ({String(item.stimulus.example.gap)}): {item.stimulus.example.filled}</span></div> : null}
          {item.stimulus.phrase_bank ? (
            <div className="bank">{(Array.isArray(item.stimulus.phrase_bank) ? item.stimulus.phrase_bank.map((p, i) => [String(i + 1), p]) : Object.entries(item.stimulus.phrase_bank)).map(([k, p]) => <span key={k}><b>{k}</b> — {p}</span>)}</div>
          ) : null}
          {item.stimulus.word_bank?.length ? <div className="bank"><span>Банк слов: {item.stimulus.word_bank.join(' · ')}</span></div> : null}
        </div>
      ) : null}

      {item.requires_audio ? (
        item.audio?.status === 'available' ? (
          <div className="mt8">
            <AudioPlayer assetId={item.audio.asset_id} devOnly={!!item.audio.dev_only} qa={item.audio.qa} />
            <p className="disclosure">{item.audio.dev_only ? 'Локальная синтезированная озвучка (открытая модель на этом компьютере) — для разработки и DEV-PREVIEW, ученикам не выпускается.' : 'Синтезированный голос el-GR. Прошёл технические и цифровые проверки, не проверен носителем языка.'}</p>
          </div>
        ) : (
          <div className="banner warn"><Icon name="headphones" /><span><strong>Аудио пока недоступно.</strong> Без проверенной записи задание на аудирование не проводится и не оценивается; транскрипт не заменяет звук.</span></div>
        )
      ) : null}

      {item.criteria_ru.length ? (
        <details className="box mt8"><summary>Что важно в ответе</summary><ul className="criteria">{item.criteria_ru.map((c) => <li key={c}>{c}</li>)}</ul></details>
      ) : null}

      {!audioBlocked ? (
        <div className="mt16">
          {item.response_kind === 'choice' ? (
            <div role="radiogroup" aria-label="Варианты ответа">
              {item.options.map((o) => {
                const chosen = choice === o.key;
                const cls = result && chosen ? (result.verdict === 'CORRECT' ? 'good' : result.verdict === 'INCORRECT_CONFIRMED' ? 'bad' : 'selected') : chosen ? 'selected' : '';
                return (
                  <button key={o.key} type="button" role="radio" aria-checked={chosen} className={`answer ${cls}`} disabled={locked} onClick={() => setChoice(o.key)} lang={isGreek(o.label) ? 'el' : 'ru'}>
                    <span>{o.label}</span>{chosen ? <Icon name="check" size={16} /> : null}
                  </button>
                );
              })}
              {item.criteria_ru.length ? (
                <div className="field"><label htmlFor={`just-${item.item_id}`}>Обоснование (необязательно)</label><textarea id={`just-${item.item_id}`} value={text} disabled={locked} onChange={(e) => setText(e.target.value)} /></div>
              ) : null}
            </div>
          ) : item.response_kind === 'open_text' ? (
            <div className="field">
              <label htmlFor={`ans-${item.item_id}`}>Ваш ответ{item.spoken_task ? ' (письменно — не засчитывается как устная речь)' : ''}</label>
              <textarea id={`ans-${item.item_id}`} className="greek-input" lang="el" value={text} disabled={locked} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              <span className="hint">{words} слов</span>
            </div>
          ) : (
            <div className="field">
              <label htmlFor={`ans-${item.item_id}`}>Ваш ответ</label>
              <input id={`ans-${item.item_id}`} className="input greek-input" lang="el" value={text} disabled={locked} autoComplete="off" spellCheck={false} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !locked) submit(); }} />
              {item.format_hint_ru ? <span className="hint">{item.format_hint_ru}</span> : <span className="hint">Ударения учитываются. Греческая раскладка: включите её в системе.</span>}
            </div>
          )}
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          {!result ? (
            <div className="row mt8">
              <button className="btn" type="button" onClick={submit} disabled={busy}>{busy ? 'Проверяю…' : netFail ? 'Повторить отправку' : 'Проверить'}</button>
              {assistance !== 'none' ? <span className="tiny muted">Повтор после показа ответа — сохраняется как попытка с помощью.</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <AnimatePresence>
      {result && v ? (
        <motion.div aria-live="polite" initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}>
          <div className={`verdict ${v.cls}`}>
            <b>{v.cls === 'good' ? <VerdictMark ok /> : v.cls === 'bad' ? <VerdictMark /> : null}{v.title}{result.replayed ? ' (повторная отправка не создала дубль)' : ''}</b>
            {result.feedback_ru}
            {result.explanation_ru ? <div className="mt8" style={{ color: 'var(--ink-2)' }}><b style={{ display: 'inline', fontSize: 13 }}>Почему: </b>{result.explanation_ru}</div> : null}
            {result.ai?.used ? <div className="mt8"><span className="ai-label">AI-проверка по критериям · не преподаватель{result.ai.confidence ? ` · уверенность: ${result.ai.confidence === 'high' ? 'высокая' : result.ai.confidence === 'medium' ? 'средняя' : 'низкая'}` : ''}</span></div> : null}
            {result.ai?.dimensions?.length ? <ul className="criteria">{result.ai.dimensions.map((d) => <li key={d.criterion_id}><b>{d.label_ru}</b>: {LEVEL_RU[d.level] ?? d.level}. {d.note_ru}</li>)}</ul> : null}
            {result.ai?.errors?.length ? <ul className="criteria">{result.ai.errors.map((e, i) => <li key={i}><span lang="el">«{e.quote}» → <b>{e.correction_el}</b></span> — {e.explanation_ru}</li>)}</ul> : null}
          </div>
          {result.reveal && (result.reveal.key.length || result.reveal.model_response) ? (
            <div className="reveal">
              {result.reveal.key.length ? <div>Ответ по ключу: <span className="greek-serif" lang="el">{result.reveal.key.join(' / ')}</span></div> : null}
              {result.reveal.model_response ? <div className="mt8">Пример ответа (один из возможных): <div className="stimulus" lang="el">{result.reveal.model_response}</div></div> : null}
              {result.ai?.improved_el ? <div className="mt8">Как можно сказать естественнее: <span className="greek-serif" lang="el">{result.ai.improved_el}</span></div> : null}
            </div>
          ) : null}
          <p className="tiny muted mt8">
            {result.preview ? 'Предпросмотр: на прогресс не влияет.' : result.mastery_counted ? 'Засчитано как самостоятельное доказательство.' : 'На освоение навыка не влияет (нет надёжного доказательства или была помощь).'}
            {result.review ? ` Отсроченная проверка D${result.review.interval_days}: ${result.review.outcome === 'passed' ? 'пройдена' : result.review.outcome === 'failed' ? 'нужно повторить' : 'с помощью — не засчитана'}.` : ''}
            {result.scheduled_reviews.length ? ` Повторим: ${result.scheduled_reviews.join(', ')}.` : ''}
          </p>
          <div className="row mt8">
            {props.allowContext !== false && result.verdict === 'INCORRECT_CONFIRMED' ? <button className="btn flat" type="button" onClick={() => setShowContext((s) => !s)}>{showContext ? 'Скрыть разбор' : 'Почему так?'}</button> : null}
            <button className="btn outline" type="button" onClick={retry}>Ещё раз</button>
            {!result.preview && ['INCORRECT_CONFIRMED', 'ABSTAIN', 'AMBIGUOUS'].includes(result.verdict) && appeal === 'idle' ? <button className="text-link" type="button" onClick={() => setAppeal('open')}>Оспорить оценку</button> : null}
          </div>
          {appeal === 'open' ? (
            <div className="field">
              <label htmlFor={`appeal-${result.attempt_id}`}>Почему вы считаете ответ верным?</label>
              <textarea id={`appeal-${result.attempt_id}`} value={appealText} onChange={(e) => setAppealText(e.target.value)} />
              <button className="btn outline" type="button" onClick={sendAppeal}>Отправить на проверку</button>
            </div>
          ) : appeal === 'sent' ? <p className="small muted">Оспаривание отправлено. Исходная оценка сохранена, отрицательное влияние заморожено до решения.</p> : null}
          {showContext ? <ContextCoach attemptId={result.attempt_id} feedbackEventId={result.feedback_event_id} preview={!!props.preview} /> : null}
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Check/cross drawn once when the verdict arrives (stroke animation, no confetti). */
function VerdictMark({ ok }: { ok?: boolean }) {
  return (
    <svg className="verdict-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={ok ? 'var(--olive)' : 'var(--danger)'} />
      <motion.path d={ok ? 'M7 12.5l3.2 3.2L17 9' : 'M8 8l8 8M16 8l-8 8'} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.08 }} />
    </svg>
  );
}
