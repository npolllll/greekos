'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Expand = 'unit' | 'item' | 'exam_component' | 'pegp_packet' | 'rg_expression' | 'scenario' | 'audio_asset' | 'diagnostics';

/**
 * Explicit owner release decision for one exact content hash (and dependencies via `expand`).
 * Digital-policy releases re-display the accepted risk; external reviews require evidence.
 */
export function ReleaseDialog(props: {
  expand: Expand;
  id: string;
  label: string;
  title: string;
  policyActive: boolean;
  policyStatement: string | null;
  requiresExpiry?: boolean;
  note?: string;
  variant?: 'outline' | 'flat' | '';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'OWNER_DIGITAL_POLICY' | 'HUMAN_TEACHER_REVIEW' | 'HUMAN_EXAMINER_REVIEW'>(props.policyActive ? 'OWNER_DIGITAL_POLICY' : 'HUMAN_TEACHER_REVIEW');
  const [method, setMethod] = useState('Структурный импорт (схема, хеши, FK) + просмотр владельцем в редакторском режиме');
  const [rights, setRights] = useState('Оригинальный контент проекта GreekOS; показ приглашённым ученикам платформы');
  const [reviewer, setReviewer] = useState('');
  const [evidencePath, setEvidencePath] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [expires, setExpires] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped_existing: number; audio_pending: string[]; targets: number } | null>(null);

  async function submit() {
    setError(null);
    if (!ack) return setError('Подтвердите решение о выпуске.');
    if (props.requiresExpiry && !expires) return setError('Для ΠΕΓΠ укажите дату окончания допуска (сессия экзамена).');
    setBusy(true);
    const res = await fetch('/api/admin/releases', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expand: props.expand, id: props.id, review_type: type, method, rights_scope: rights,
        ...(type !== 'OWNER_DIGITAL_POLICY' ? { reviewer_identity: reviewer, evidence_path: evidencePath, evidence_hash: evidenceHash } : {}),
        ...(expires ? { expires_at: new Date(`${expires}T23:59:59Z`).toISOString() } : {}),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.message ?? 'Выпуск не выполнен');
    setResult(json);
    router.refresh();
  }

  return (
    <>
      <button type="button" className={`btn ${props.variant ?? ''}`} onClick={() => { setOpen(true); setResult(null); setAck(false); }}>{props.label}</button>
      {open ? (
        <>
          <div className="overlay show" onClick={() => setOpen(false)} />
          <section className="modal show modal-wide" role="dialog" aria-modal="true" aria-label={props.title}>
            <div className="row between"><b>{props.title}</b><button type="button" className="close" onClick={() => setOpen(false)} aria-label="Закрыть">×</button></div>
            {result ? (
              <div className="mt16">
                <div className="banner ok"><span>Создано записей допуска: <b>{result.created}</b> из {result.targets}. Уже были выпущены: {result.skipped_existing}.</span></div>
                {result.audio_pending.length ? <div className="banner warn"><span>{result.audio_pending.length} заданий требуют аудио: они останутся закрытыми для учеников, пока не будет выпущено проверенное аудио.</span></div> : null}
                <button type="button" className="btn outline" onClick={() => setOpen(false)}>Закрыть</button>
              </div>
            ) : (
              <div className="mt16">
                {props.note ? <p className="small quiet">{props.note}</p> : null}
                <div className="field">
                  <label htmlFor="rel-type">Основание выпуска</label>
                  <select id="rel-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                    <option value="OWNER_DIGITAL_POLICY" disabled={!props.policyActive}>Цифровая политика владельца{props.policyActive ? '' : ' (не подписана)'}</option>
                    <option value="HUMAN_TEACHER_REVIEW">Внешняя проверка преподавателем (есть доказательство)</option>
                    <option value="HUMAN_EXAMINER_REVIEW">Внешняя проверка экзаменатором (есть доказательство)</option>
                  </select>
                </div>
                {type === 'OWNER_DIGITAL_POLICY' ? (
                  <div className="warning-note"><b>Принятый риск:</b> {props.policyStatement ?? '—'} Ученики увидят маркировку «Цифровая проверка, без независимой экспертизы».</div>
                ) : (
                  <div className="grid-2">
                    <div className="field"><label htmlFor="rel-rev">Кто проверял (имя, роль)</label><input id="rel-rev" value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></div>
                    <div className="field"><label htmlFor="rel-path">Путь/ссылка на заключение</label><input id="rel-path" value={evidencePath} onChange={(e) => setEvidencePath(e.target.value)} /></div>
                    <div className="field"><label htmlFor="rel-hash">SHA-256 заключения</label><input id="rel-hash" value={evidenceHash} onChange={(e) => setEvidenceHash(e.target.value)} /></div>
                  </div>
                )}
                <div className="field"><label htmlFor="rel-method">Метод проверки</label><input id="rel-method" value={method} onChange={(e) => setMethod(e.target.value)} /></div>
                <div className="field"><label htmlFor="rel-rights">Права и охват показа</label><input id="rel-rights" value={rights} onChange={(e) => setRights(e.target.value)} /></div>
                <div className="field"><label htmlFor="rel-exp">Действует до{props.requiresExpiry ? ' (обязательно)' : ' (необязательно)'}</label><input id="rel-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
                <div className="check-list"><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я принимаю решение о выпуске именно текущей версии (хеша) этих материалов. Изменение текста, ключа или источника автоматически отзовёт допуск.</label></div>
                {error ? <p className="error-text" role="alert">{error}</p> : null}
                <div className="row"><button type="button" className="btn" disabled={busy} onClick={submit}>{busy ? 'Записываю…' : 'Выпустить'}</button><button type="button" className="btn outline" onClick={() => setOpen(false)}>Отмена</button></div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
