import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { examOverview } from '@/lib/exams/service';
import { EXAM_DISCLAIMER_RU, KIND_RU, REASON_RU, STATUS_RU, formNumber } from '@/lib/exams/core';
import { Icon } from '@/components/Icon';
import './exams.css';

export const metadata = { title: 'Экзамены ΚΕΓ' };

export default async function ExamsPage() {
  const u = await requireLearner();
  const forms = await examOverview(u.userId);
  const startable = forms.flatMap((f) => f.components).filter((c) => c.availability.startable).length;
  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Экзамены</div><h1 className="screen-title">Подготовка к B2 (ΚΕΓ)</h1><p className="screen-sub">Три тренировочные формы F01–F03, по пять компонентов. Отдельно от курса, ΠΕΓΠ и Живого греческого.</p></div>
        <span className="pill"><span className="dot" /> Таймер и автосохранение на сервере</span>
      </div>
      <div className="banner info"><Icon name="info" /><span><strong>{EXAM_DISCLAIMER_RU}</strong> Результаты — предварительные сырые подсчёты по надёжно оцениваемым заданиям; свободные ответы оцениваются по рубрике с пометкой AI или ждут проверки.</span></div>
      {startable === 0 ? <div className="banner warn"><Icon name="lock" /><span><strong>Компоненты проходят проверку.</strong> Экзамен можно начать только когда все задания компонента выпущены; аудирование — только с проверенным звуком.</span></div> : null}
      <div className="exam-grid">
        {forms.map((f) => (
          <article className="card exam-card" key={f.form_id}>
            <div className="exam-form-head">
              <div><span className="tag gray">Форма {formNumber(f.form_id)}</span><h3>{f.form_id}</h3></div>
              <span className="tag">{f.components.length} компонентов</span>
            </div>
            <p>{f.text_assembly_complete ? 'Тексты всех компонентов собраны. ' : 'Тексты компонентов присутствуют. '}Статус формы: <span className="code">{f.status ?? '—'}</span></p>
            <div className="exam-parts" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(92px,1fr))' }}>
              {f.components.map((c) => {
                const done = c.last?.status === 'SUBMITTED';
                const cls = c.availability.startable ? (done ? 'done' : 'ok') : c.availability.reason === 'AUDIO_PENDING' ? 'audio' : '';
                const label = c.open_attempt_id ? 'продолжить' : done ? 'сдано' : c.availability.startable ? 'доступно' : c.availability.reason === 'SPEAKING' ? 'в «Разговорах»' : c.availability.reason === 'AUDIO_PENDING' ? 'нет аудио' : 'на проверке';
                return (
                  <Link key={c.component_id} href={`/exams/${c.component_id}`} className="exam-part" aria-label={`${KIND_RU[c.kind]} ${c.display_id}: ${REASON_RU[c.availability.reason]}`}>
                    <b>{KIND_RU[c.kind]}</b>
                    <small>{c.display_id.replace('KEG-B2-', '')}{c.duration_minutes ? ` · ${c.duration_minutes} мин` : ''}</small>
                    <span className={`chip-state ${cls}`}>{label}</span>
                  </Link>
                );
              })}
            </div>
            {f.components.some((c) => c.last?.status === 'SUBMITTED') ? (
              <div className="small quiet">
                Последние попытки: {f.components.filter((c) => c.last?.status === 'SUBMITTED').map((c) => (
                  <Link key={c.component_id} className="text-link" href={`/exams/results/${c.last!.id}`}>{c.display_id.replace('KEG-B2-', '')} ({STATUS_RU[c.last!.status]})</Link>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
