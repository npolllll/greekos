import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { adminClient, selectAll } from '@/lib/supabase/admin';
import { releaseMap, type ItemRow } from '@/lib/content/repo';
import { deliverItems } from '@/lib/content/delivery';
import { Icon } from '@/components/Icon';
import { LessonClient, type LessonStep } from './LessonClient';

export const metadata = { title: 'Урок' };

const ITEM_COLUMNS = 'item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash';

interface Teaching {
  title_ru: string;
  cefr_level: string;
  learning_outcome?: string;
  learning_objectives?: string[];
  theory_ru?: string;
  examples_el?: string[];
  vocabulary_items?: Array<{ lemma: string; inflection?: string; meaning_ru?: string; example?: string; collocations?: string[] }>;
  estimated_active_minutes?: number | null;
  review_plan?: { days?: number[] };
  qa?: { status?: string; human_review?: string; audio_review?: string };
}

export default async function LessonPage({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const u = await requireLearner();
  const { unitId } = await params;
  const sp = await searchParams;
  const db = adminClient();
  const { data: unit } = await db.from('units').select('unit_id, level, title_ru, current_hash, teaching, primary_competencies').eq('unit_id', unitId).maybeSingle();
  if (!unit) notFound();
  const rel = await releaseMap('unit', [{ id: unit.unit_id, hash: unit.current_hash }]);
  const released = rel.has(unit.unit_id);
  const preview = u.isOwner && (!released || sp.preview === '1');
  if (!released && !preview) {
    return (
      <section className="screen active">
        <div className="screen-head"><div><div className="eyebrow">GreekOS / Урок</div><h1 className="screen-title">{unit.title_ru}</h1></div></div>
        <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Этот урок откроется после выпуска владельцем. Это не связано с вашими результатами.</span></div>
        <Link className="btn outline" href="/course">Вернуться к маршруту</Link>
      </section>
    );
  }
  const t = unit.teaching as Teaching;
  const rows = await selectAll<ItemRow>((f, to) => db.from('items').select(ITEM_COLUMNS).eq('unit_id', unit.unit_id).order('item_id').range(f, to));
  const delivered = await deliverItems(rows, { ownerPreview: preview });
  const bySection = (sections: Array<string | null>) => delivered.filter((d) => sections.includes(rows.find((r) => r.item_id === d.dto.item_id)?.section ?? null));
  const toStep = (key: string, title: string, sections: Array<string | null>): LessonStep => {
    const list = bySection(sections);
    return {
      key, title,
      items: list.filter((d) => preview || d.access.learnerUsable).map((d) => d.dto),
      locked: list.filter((d) => !(preview || d.access.learnerUsable)).map((d) => ({ item_id: d.dto.item_id, reason: d.access.reason })),
    };
  };
  const steps: LessonStep[] = [
    toStep('practice', 'Контролируемая практика', ['diagnostic', 'guided_practice', 'active_recall', null]),
    toStep('reception', 'Чтение и аудирование', ['reading', 'listening']),
    toStep('production', 'Самостоятельное применение', ['writing', 'speaking']),
    toStep('transfer', 'Перенос в новую ситуацию', ['transfer']),
  ];
  const retentionCount = rows.filter((r) => r.section === 'retention').length;
  const { data: session } = preview ? { data: null } : await db.from('lesson_sessions').select('id, status').eq('user_id', u.userId).eq('unit_id', unit.unit_id).eq('preview', false).order('started_at', { ascending: false }).limit(1).maybeSingle();

  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Урок</div><h1 className="screen-title">Урок</h1><p className="screen-sub">{unit.unit_id} · {t.cefr_level}{t.estimated_active_minutes ? ` · около ${t.estimated_active_minutes} мин (оценка автора)` : ''}</p></div>
        <span className="pill"><span className="dot" /> {preview ? 'Предпросмотр редактора' : 'Прогресс сохраняется на сервере'}</span>
      </div>
      {!preview && rel.get(unit.unit_id)?.review_type === 'OWNER_DIGITAL_POLICY' ? (
        <div className="banner warn"><Icon name="info" /><span><strong>Цифровая проверка, без независимой экспертизы.</strong> Урок выпущен владельцем по цифровой политике: автоматические и AI-проверки пройдены, но преподаватель и экзаменатор его не проверяли.</span></div>
      ) : rel.get(unit.unit_id)?.review_type?.startsWith('HUMAN_') ? <div className="banner ok"><Icon name="check" /><span>Урок прошёл внешнюю проверку (запись о проверке хранится у владельца).</span></div> : null}
      <div className={`lesson-head ${preview ? 'watermark' : ''}`}>
        <span className="tag">{t.cefr_level}</span>
        <h2 style={{ margin: '10px 0 4px', fontSize: 21, letterSpacing: '-.6px' }}>{t.title_ru}</h2>
        <p className="quiet small" style={{ margin: 0 }}>{t.learning_outcome}</p>
      </div>
      <LessonClient
        unitId={unit.unit_id}
        unitHash={unit.current_hash}
        preview={preview}
        sessionId={session?.id ?? null}
        completed={session?.status === 'COMPLETED'}
        theory={t.theory_ru ?? ''}
        objectives={t.learning_objectives ?? []}
        examples={t.examples_el ?? []}
        vocabulary={(t.vocabulary_items ?? []).map((v) => ({ lemma: v.lemma, inflection: v.inflection ?? '', meaning: v.meaning_ru ?? '', example: v.example ?? '' }))}
        steps={steps}
        retentionCount={retentionCount}
        qa={{ status: t.qa?.status ?? 'AUTO_VALIDATED', human: t.qa?.human_review ?? 'NOT_REVIEWED', audio: t.qa?.audio_review ?? 'MISSING_AUDIO' }}
      />
    </section>
  );
}
