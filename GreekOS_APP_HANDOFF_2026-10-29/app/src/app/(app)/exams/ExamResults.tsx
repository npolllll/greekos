import type { StoredResults } from '@/lib/exams/service';
import { RESULT_DISCLAIMER_RU } from '@/lib/exams/core';

const VERDICT_RU: Record<string, { cls: string; label: string }> = {
  CORRECT: { cls: 'good', label: 'верно' },
  ACCEPTABLE_VARIANT: { cls: 'variant', label: 'допустимый вариант' },
  INCORRECT_CONFIRMED: { cls: 'bad', label: 'ошибка' },
  PENDING_REVIEW: { cls: 'pending', label: 'на проверке' },
  ABSTAIN: { cls: 'pending', label: 'без оценки (AI воздержался)' },
  AMBIGUOUS: { cls: 'pending', label: 'неоднозначно' },
  NOT_ASSESSED: { cls: 'pending', label: 'без ответа' },
  UNSUPPORTED: { cls: 'pending', label: 'не поддерживается' },
};

/** Post-submission feedback: keys only now, raw counts only, provisional labels everywhere. */
export function ExamResults({ results, prompts, options }: { results: StoredResults; prompts: Record<string, string>; options: Record<string, Record<string, string>> }) {
  const s = results.summary;
  return (
    <div className="stack">
      <div className="banner warn" role="status"><span><strong>{RESULT_DISCLAIMER_RU}</strong> Нет перевода в официальные баллы ΚΕΓ: калибровки и экзаменаторской проверки не было.</span></div>
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Ключевые задания</small><div className="metric mono">{s.keyed_correct_reliable} / {s.keyed_total}</div><small className="quiet">верно по ключу (надёжно)</small></div>
        <div className="card admin-stat"><small className="quiet">Отвечено</small><div className="metric mono">{s.answered} / {s.total}</div><small className="quiet">без ответа: {s.unanswered}</small></div>
        <div className="card admin-stat"><small className="quiet">На проверке</small><div className="metric mono">{s.held_for_review}</div><small className="quiet">без автоматического штрафа</small></div>
        <div className="card admin-stat"><small className="quiet">AI-оценка по рубрике</small><div className="metric mono">{s.ai_assessed}</div><small className="quiet">не преподаватель</small></div>
      </div>
      <div className="card cardpad">
        <div className="card-title" style={{ marginBottom: 6 }}>Разбор по заданиям</div>
        {results.items.map((r, i) => {
          const v = VERDICT_RU[r.verdict] ?? VERDICT_RU.PENDING_REVIEW;
          const given = r.response?.choice !== undefined ? options[r.item_id]?.[r.response.choice] ?? r.response.choice : r.response?.text ?? '';
          return (
            <div className="result-row" key={r.item_id}>
              <div>
                <div className="tiny muted">{i + 1}. {r.item_id}</div>
                {prompts[r.item_id] ? <div lang="el" className="small" style={{ margin: '3px 0' }}>{prompts[r.item_id]}</div> : null}
                <div className="answer-line">Ваш ответ: <span lang="el">{given ? (given.length > 240 ? `${given.slice(0, 240)}…` : given) : '—'}</span></div>
                {r.key.length ? <div className="answer-line">Ключ: <span lang="el" className="greek-serif" style={{ fontSize: 14 }}>{r.key.join(' / ')}</span></div> : null}
                {r.model_response ? <details className="box mt8"><summary>Пример ответа (один из возможных)</summary><div className="stimulus" lang="el">{r.model_response}</div></details> : null}
                {r.feedback_ru ? <div className="tiny muted mt8">{r.feedback_ru}</div> : null}
                {r.scorer === 'ai_assessor' ? <span className="ai-label mt8">AI-проверка по рубрике · не преподаватель{r.ai?.confidence ? ` · уверенность: ${r.ai.confidence}` : ''}</span> : null}
                {r.scorer === 'joint_bank' ? <span className="tag gray mt8">оценивается всей группой C1–C7</span> : null}
              </div>
              <span className={`verdict ${v.cls}`} style={{ marginTop: 0, padding: '6px 9px', height: 'fit-content', fontSize: 10.5 }}>{v.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
