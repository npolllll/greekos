'use client';
import type { ItemDTO } from '@/lib/content/dto';
import type { ExamAnswer } from '@/lib/exams/core';

function isGreek(s: string) {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.filter((c) => /[Ͱ-Ͽἀ-῿]/u.test(c)).length / letters.length > 0.5;
}

/** Exam input without instant feedback: stable option keys, text for short/structured, textarea for open. */
export function ExamItemInput(props: {
  item: ItemDTO;
  index: number;
  value: ExamAnswer | undefined;
  onChange: (v: ExamAnswer) => void;
  disabled: boolean;
  sharedTextIds: string[];
  columns: string[];
}) {
  const { item, value } = props;
  const words = (value?.text?.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const showOwnText = item.stimulus && (item.stimulus.kind === 'inline' || (item.stimulus.kind === 'text' && !props.sharedTextIds.includes(item.stimulus.text_id ?? '')));
  const short = item.options.every((o) => o.label.length <= 3);
  const inputId = `exam-${item.item_id}`;
  return (
    <div className="card exam-item" id={`q-${item.item_id}`}>
      <div className="row between"><span className="num">Задание {props.index + 1}</span><span className="tiny muted">{item.item_id}</span></div>
      <div className={`player-prompt ${isGreek(item.prompt) ? 'greek' : ''}`} lang={isGreek(item.prompt) ? 'el' : 'ru'} style={{ fontSize: isGreek(item.prompt) ? 18 : 14 }}>{item.prompt}</div>
      {item.stimulus?.focus ? (
        <p className="tiny muted" style={{ margin: '0 0 8px' }}>
          {Object.entries(item.stimulus.focus).map(([k, v]) => (k === 'gap' ? `Пропуск (${v})` : k === 'target_segment' ? `Сегмент (${v})` : k === 'cue_id' ? `Фрагмент записи ${v}` : k === 'comparison_row' ? `Строка ${v}` : `${k}: ${v}`)).join(' · ')}
        </p>
      ) : null}
      {showOwnText ? <div className="stimulus" lang="el" tabIndex={0}>{item.stimulus!.text}</div> : null}
      {item.response_kind === 'choice' ? (
        <div role="radiogroup" aria-label={`Варианты ответа к заданию ${props.index + 1}`} className={short ? 'exam-choice-grid' : ''}>
          {item.options.map((o) => {
            const chosen = value?.choice === o.key;
            return (
              <button key={o.key} type="button" role="radio" aria-checked={chosen} disabled={props.disabled} className={`answer ${chosen ? 'selected' : ''}`} onClick={() => props.onChange({ choice: o.key })} lang={isGreek(o.label) ? 'el' : undefined}>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      ) : item.response_kind === 'open_text' ? (
        <div className="field">
          <label htmlFor={inputId}>Ваш текст</label>
          <textarea id={inputId} className="greek-input" lang="el" spellCheck={false} disabled={props.disabled} value={value?.text ?? ''} onChange={(e) => props.onChange({ text: e.target.value })} style={{ minHeight: 220 }} />
          <span className="hint">{words} слов</span>
        </div>
      ) : item.type === 'multiple_assignment' && props.columns.length ? (
        <div className="field">
          <label htmlFor={inputId}>Кто это говорит?</label>
          <select id={inputId} disabled={props.disabled} value={value?.text ?? ''} onChange={(e) => props.onChange({ text: e.target.value })}>
            <option value="">— выберите —</option>
            {props.columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      ) : (
        <div className="field">
          <label htmlFor={inputId}>Ответ</label>
          <input id={inputId} className="input greek-input" lang="el" autoComplete="off" spellCheck={false} disabled={props.disabled} value={value?.text ?? ''} onChange={(e) => props.onChange({ text: e.target.value })} />
          {item.format_hint_ru ? <span className="hint">{item.format_hint_ru}</span> : null}
        </div>
      )}
    </div>
  );
}
