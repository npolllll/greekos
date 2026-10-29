import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { adminClient } from '@/lib/supabase/admin';
import { candidateComponent, loadComponent, publicState, type ExamAttemptRow } from '@/lib/exams/service';
import { EXAM_DISCLAIMER_RU, KIND_RU, REASON_RU, displayComponentId } from '@/lib/exams/core';
import { Icon } from '@/components/Icon';
import { ExamRunner } from './ExamRunner';
import { ExamPreview } from './ExamPreview';
import '../exams.css';

export const metadata = { title: 'Экзаменационный компонент' };

export default async function ExamComponentPage({ params, searchParams }: { params: Promise<{ componentId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const u = await requireLearner();
  const { componentId } = await params;
  const sp = await searchParams;
  const c = await loadComponent(decodeURIComponent(componentId));
  if (!c) notFound();
  const view = await candidateComponent(c);
  const display = displayComponentId(c.component_id, c.logical_id);
  const kindRu = KIND_RU[view.kind];
  const preview = u.isOwner && (sp.preview === '1' || !view.availability.startable);
  const items = view.delivered.map((d) => d.dto);

  const { data: open } = await adminClient().from('exam_attempts')
    .select('id, user_id, component_id, component_hash, mode, status, server_started_at, server_expires_at, answers_private, autosave_seq, submitted_at, results, idempotency_key')
    .eq('user_id', u.userId).eq('component_id', c.component_id).in('status', ['IN_PROGRESS', 'EXPIRED']).order('server_started_at', { ascending: false }).limit(1).maybeSingle();

  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <div className="eyebrow">GreekOS / Экзамены / {c.form_id.replace('KEG-B2-', '')}</div>
          <h1 className="screen-title">{kindRu} · {display.replace('KEG-B2-', '')}</h1>
          <p className="screen-sub">{display !== c.component_id ? `Логический ${display}; канонический ID ${c.component_id}. ` : ''}{view.duration.minutes ? `Заявленное время: ${view.duration.minutes} мин.` : 'Время для компонента не задано.'} {items.length} заданий.</p>
        </div>
        <Link className="btn outline" href="/exams"><Icon name="school" size={15} /> Все формы</Link>
      </div>
      <div className="banner info"><Icon name="info" /><span>{EXAM_DISCLAIMER_RU} Подсказок нет; ключи и разбор — только после отправки.</span></div>

      {view.kind === 'speaking' ? (
        <div className="stack">
          <div className="banner warn"><Icon name="mic" /><span><strong>Говорение здесь не оценивается.</strong> Устная часть проходит в разделе «Разговоры» в режиме «Экзамен B2 (учебная симуляция)» с AI-собеседником; произношение по тексту не оценивается, результат не официальный.</span></div>
          {(view.availability.usable === view.availability.item_total || u.isOwner) && items.length ? (
            <div className={`card cardpad ${preview ? 'watermark' : ''}`}>
              <div className="card-title" style={{ marginBottom: 8 }}>Задания устной части</div>
              {items.map((it, i) => <div className="review-row" key={it.item_id}><div><b>{i + 1}. {it.item_id.replace('KEG-B2-', '')}</b><div lang="el" className="small" style={{ marginTop: 4 }}>{it.prompt}</div></div></div>)}
            </div>
          ) : <div className="card empty"><strong>Задания устной части проходят проверку</strong>Они появятся после выпуска.</div>}
          <Link className="btn" href={`/speaking?mode=b2_mock&component=${encodeURIComponent(c.component_id)}`}>Перейти к устной симуляции <Icon name="arrow" size={14} /></Link>
        </div>
      ) : open && !preview ? (
        <ExamRunner componentId={c.component_id} displayId={display} kindRu={kindRu} items={items} texts={view.texts} columns={view.columns} durationMinutes={view.duration.minutes} initial={publicState(open as ExamAttemptRow)} />
      ) : view.availability.startable && !preview ? (
        <ExamRunner componentId={c.component_id} displayId={display} kindRu={kindRu} items={items} texts={view.texts} columns={view.columns} durationMinutes={view.duration.minutes} initial={null} />
      ) : preview ? (
        <div className="stack">
          <div className="banner warn"><Icon name="lock" /><span><strong>Предпросмотр владельца.</strong> Для учеников: {REASON_RU[view.availability.reason]} ({view.availability.usable} из {view.availability.item_total} заданий доступны{view.availability.audio_pending ? `, без аудио: ${view.availability.audio_pending}` : ''}). Попытки в предпросмотре не создаются.</span></div>
          {view.kind === 'listening' ? <div className="banner danger"><Icon name="headphones" /><span>Транскрипт аудирования ученикам не показывается и не заменяет звук.</span></div> : null}
          <ExamPreview componentId={c.component_id} items={items} texts={view.texts} columns={view.columns} />
        </div>
      ) : (
        <div className="stack">
          <div className="banner warn"><Icon name={view.availability.reason === 'AUDIO_PENDING' ? 'headphones' : 'lock'} /><span><strong>{REASON_RU[view.availability.reason]}.</strong> {view.availability.reason === 'AUDIO_PENDING' ? 'Полная симуляция аудирования начнётся только после того, как все записи пройдут проверку и будут выпущены. Транскрипт не заменяет звук.' : `Выпущено ${view.availability.usable} из ${view.availability.item_total} заданий. Компонент откроется целиком, когда проверку пройдут все задания.`}</span></div>
          <Link className="btn outline" href="/exams">Вернуться к формам</Link>
        </div>
      )}
    </section>
  );
}
