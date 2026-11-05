import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { adminClient } from '@/lib/supabase/admin';
import { loadComponent, loadExamItems, type StoredResults } from '@/lib/exams/service';
import { KIND_RU, STATUS_RU, displayComponentId, componentKindOf } from '@/lib/exams/core';
import { choiceOptions } from '@/lib/content/types';
import { Icon } from '@/components/Icon';
import { ExamResults } from '../../ExamResults';
import '../../exams.css';

export const metadata = { title: 'Результат компонента' };

export default async function ExamResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const u = await requireLearner();
  const { attemptId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) notFound();
  const { data: a } = await adminClient().from('exam_attempts').select('id, user_id, component_id, mode, status, submitted_at, results').eq('id', attemptId).maybeSingle();
  if (!a || a.user_id !== u.userId) notFound();
  const c = await loadComponent(a.component_id);
  const rows = c ? await loadExamItems(c.item_ids) : [];
  const prompts = Object.fromEntries(rows.map((r) => [r.item_id, r.envelope.prompt]));
  const options = Object.fromEntries(rows.map((r) => [r.item_id, Object.fromEntries(choiceOptions(r.envelope.options).map((o) => [o.key, o.label]))]));
  const results = a.results as StoredResults | null;
  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <div className="eyebrow">GreekOS / Экзамены / Результат</div>
          <h1 className="screen-title">{KIND_RU[componentKindOf(a.component_id)]} · {displayComponentId(a.component_id, c?.logical_id ?? null).replace('KEG-B2-', '')}</h1>
          <p className="screen-sub">Статус: {STATUS_RU[a.status] ?? a.status}{a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleString('ru-RU')}` : ''} · {a.mode === 'simulation' ? 'симуляция с таймером' : 'практика'}</p>
        </div>
        <Link className="btn outline" href={`/exams/${a.component_id}`}><Icon name="rotate" size={15} /> К компоненту</Link>
      </div>
      {results ? <ExamResults results={results} prompts={prompts} options={options} /> : <div className="card empty"><strong>Результатов пока нет</strong>Попытка не сдана или подсчёт ещё идёт.</div>}
    </section>
  );
}
