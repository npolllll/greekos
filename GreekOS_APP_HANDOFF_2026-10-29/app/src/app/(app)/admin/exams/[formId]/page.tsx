import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage, audit } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export const metadata = { title: 'Редакторский комплект' };

/** Owner-only editor booklet (contains keys and rationale); never shown to candidates. */
export default async function ExamEditorPage({ params }: { params: Promise<{ formId: string }> }) {
  const owner = await requireOwnerPage();
  const { formId } = await params;
  const { data: f } = await adminClient().from('exam_forms').select('form_id, current_hash, payload').eq('form_id', formId).maybeSingle();
  if (!f) notFound();
  await audit(owner.userId, 'exam.editor_viewed', { id: f.form_id });
  const md = (f.payload as { editor_markdown?: string }).editor_markdown ?? '';
  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">{f.form_id} · редакторский комплект</div><Link className="text-link" href="/admin/exams">← Экзамены</Link></div>
      <div className="banner danger"><span><strong>Редакторский комплект с ключами — не показывать ученикам.</strong> Просмотр записан в журнал аудита.</span></div>
      <p className="tiny muted">Хеш сборки: <span className="code">{f.current_hash}</span></p>
      <div className="pre-block" lang="el">{md}</div>
    </div>
  );
}
