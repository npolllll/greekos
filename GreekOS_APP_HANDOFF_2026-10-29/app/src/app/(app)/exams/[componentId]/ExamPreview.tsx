'use client';
import { useState } from 'react';
import type { ItemDTO, StimulusDTO } from '@/lib/content/dto';
import type { ExamAnswer, ExamAnswers } from '@/lib/exams/core';
import { ExamItemInput } from '../ExamItemInput';

interface PreviewResult { summary: { keyed_total: number; keyed_correct_reliable: number; held_for_review: number; answered: number; total: number }; items: Array<{ item_id: string; verdict: string; feedback_ru: string; key: string[] }> }

/** Owner editorial preview: watermarked, client-only answers, deterministic check without persistence. */
export function ExamPreview(props: { componentId: string; items: ItemDTO[]; texts: Array<StimulusDTO & { text_id: string }>; columns: string[] }) {
  const [answers, setAnswers] = useState<ExamAnswers>({});
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    setError(null);
    const r = await fetch('/api/exams/preview-score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ component_id: props.componentId, answers }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.message ?? 'Ошибка проверки');
    setResult(j);
  }
  const byId = new Map(result?.items.map((i) => [i.item_id, i]) ?? []);
  return (
    <div className="watermark" style={{ paddingTop: 24 }}>
      {props.texts.map((t) => (
        <div className="card cardpad mt8" key={t.text_id}>
          <div className="tiny muted">Текст {t.text_id}</div>
          <div className="stimulus" lang="el">{t.segments?.length ? t.segments.map((s) => `(${s.label}) ${s.text}`).join('\n\n') : t.text}{t.phrase_bank ? <div className="bank">{Object.entries(t.phrase_bank).map(([k, p]) => <span key={k}><b>{k}</b> — {String(p)}</span>)}</div> : null}{t.word_bank?.length ? <div className="bank"><span>Банк: {t.word_bank.join(' · ')}</span></div> : null}</div>
        </div>
      ))}
      <div className="exam-items mt16">
        {props.items.map((it, i) => (
          <div key={it.item_id}>
            <ExamItemInput item={it} index={i} value={answers[it.item_id]} onChange={(v: ExamAnswer) => setAnswers((a) => ({ ...a, [it.item_id]: v }))} disabled={false} sharedTextIds={props.texts.map((t) => t.text_id)} columns={props.columns} />
            {byId.get(it.item_id) ? <p className="tiny muted" style={{ margin: '6px 4px' }}>{byId.get(it.item_id)!.verdict} · ключ: <span lang="el">{byId.get(it.item_id)!.key.join(' / ') || '—'}</span> · {byId.get(it.item_id)!.feedback_ru}</p> : null}
          </div>
        ))}
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="row mt16">
        <button className="btn outline" type="button" onClick={check}>Проверить по ключу (предпросмотр, без сохранения)</button>
        {result ? <span className="small quiet">По ключу: {result.summary.keyed_correct_reliable}/{result.summary.keyed_total}; на проверке: {result.summary.held_for_review}. Письмо в предпросмотре не оценивается.</span> : null}
      </div>
    </div>
  );
}
