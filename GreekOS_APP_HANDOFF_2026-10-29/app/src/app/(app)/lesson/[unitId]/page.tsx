import Link from 'next/link';
import { ViewTransition } from 'react';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { adminClient, selectAll } from '@/lib/supabase/admin';
import { releaseMap, isDevPreviewRelease, type ItemRow } from '@/lib/content/repo';
import { deliverItems } from '@/lib/content/delivery';
import { loadCourse, FOUNDATION_UNITS } from '@/lib/learning/course';
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

const LEVEL_NAME: Record<string, string> = { A1: 'A1 · Начальный', A2: 'A2 · Повседневная жизнь', B1: 'B1 · Самостоятельность', B2: 'B2 · Уверенное владение' };

export default async function LessonPage({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const u = await requireLearner();
  const { unitId } = await params;
  const sp = await searchParams;
  const db = adminClient();
  const { data: unit } = await db.from('units').select('unit_id, level, title_ru, current_hash, teaching, primary_competencies').eq('unit_id', unitId).maybeSingle();
  if (!unit) notFound();
  const rel = await releaseMap('unit', [{ id: unit.unit_id, hash: unit.current_hash }], u);
  const released = rel.has(unit.unit_id);
  const devPreview = isDevPreviewRelease(rel.get(unit.unit_id));
  const preview = u.isOwner && !u.devPreview && (!released || sp.preview === '1');
  if (!released && !preview) {
    return (
      <section className="screen active">
        <div className="screen-head"><div><div className="eyebrow">GreekOS / Урок</div><h1 className="screen-title">{unit.title_ru}</h1></div></div>
        <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Этот урок откроется после цифровой проверки и выпуска владельцем. Это не связано с вашими результатами.</span></div>
        <Link className="btn outline" href="/course" transitionTypes={['nav-back']}>Вернуться к маршруту</Link>
      </section>
    );
  }
  const t = unit.teaching as Teaching;
  const rows = await selectAll<ItemRow>((f, to) => db.from('items').select(ITEM_COLUMNS).eq('unit_id', unit.unit_id).order('item_id').range(f, to));
  const delivered = await deliverItems(rows, { ownerPreview: preview, viewer: u });
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
    toStep('practice', 'Практика', ['diagnostic', 'guided_practice', 'active_recall', 'practice', null]),
    toStep('reception', 'Чтение и слушание', ['reading', 'listening', 'reception']),
    toStep('production', 'Применение', ['writing', 'speaking', 'production']),
    toStep('transfer', 'Перенос', ['transfer']),
  ];
  const retentionCount = rows.filter((r) => r.section === 'retention').length;
  const [{ data: session }, { data: tried }, course] = await Promise.all([
    preview ? Promise.resolve({ data: null }) : db.from('lesson_sessions').select('id, status').eq('user_id', u.userId).eq('unit_id', unit.unit_id).eq('preview', false).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    preview ? Promise.resolve({ data: [] as Array<{ item_id: string }> }) : db.from('attempts').select('item_id').eq('user_id', u.userId).eq('preview', false).in('item_id', rows.map((r) => r.item_id)),
    loadCourse(u.userId, u),
  ]);
  const order = course.units.findIndex((x) => x.unit_id === unit.unit_id);
  const nextUnit = course.units.slice(order + 1).find((x) => x.released) ?? null;
  const stepsTotal = 2 + steps.filter((s) => s.items.length || s.locked.length).length;

  return (
    <section className="screen active">
      <nav className="tiny quiet" aria-label="Навигация" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <Link href="/course" transitionTypes={['nav-back']} style={{ textDecoration: 'none' }}>Маршрут</Link><span aria-hidden="true">›</span>
        <span>{FOUNDATION_UNITS.includes(unit.unit_id) ? 'A0 · Основы чтения' : LEVEL_NAME[unit.level] ?? unit.level}</span><span aria-hidden="true">›</span><span>{unit.unit_id}</span>
      </nav>
      <div className="screen-head" style={{ marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <ViewTransition name={`unit-title-${unit.unit_id}`} share="morph" default="none">
            <h1 className="screen-title" style={{ marginTop: 2 }}>{t.title_ru}</h1>
          </ViewTransition>
          <p className="screen-sub">{t.learning_outcome ?? ''}</p>
        </div>
        <div className="card" style={{ padding: '12px 16px', minWidth: 220 }}>
          <div className="row between tiny"><span className="quiet">Урок · {stepsTotal} этапов</span><span className="mono">{t.estimated_active_minutes ? `≈ ${t.estimated_active_minutes} мин` : ''}</span></div>
          <div className="row tiny" style={{ marginTop: 6, gap: 6 }}>
            {devPreview ? <span className="mode-badge preview">DEV-PREVIEW</span> : preview ? <span className="mode-badge preview">Предпросмотр</span> : <span className="mode-badge"><span className="dot" />Прогресс на сервере</span>}
          </div>
        </div>
      </div>
      {devPreview ? (
        <div className="banner preview"><Icon name="eye" /><span><strong>Урок ещё не выпущен.</strong> Он открыт этому тестовому аккаунту через DEV-PREVIEW владельца в локальной среде. Ответы и прогресс сохраняются с отметкой «не выпущено».</span></div>
      ) : !preview && rel.get(unit.unit_id)?.review_type === 'OWNER_DIGITAL_POLICY' ? (
        <div className="banner warn"><Icon name="info" /><span><strong>Цифровая проверка, без независимой экспертизы.</strong> Урок выпущен владельцем после цифрового QA: автоматические проверки пройдены, преподаватель и экзаменатор его не проверяли.</span></div>
      ) : rel.get(unit.unit_id)?.review_type?.startsWith('HUMAN_') ? <div className="banner ok"><Icon name="check" /><span>Урок прошёл внешнюю проверку (запись о проверке хранится у владельца).</span></div> : null}
      <LessonClient
        unitId={unit.unit_id}
        unitHash={unit.current_hash}
        preview={preview}
        devPreview={devPreview}
        sessionId={session?.id ?? null}
        completed={session?.status === 'COMPLETED'}
        answeredBefore={[...new Set((tried ?? []).map((x) => x.item_id))]}
        theory={t.theory_ru ?? ''}
        objectives={t.learning_objectives ?? []}
        outcome={t.learning_outcome ?? ''}
        examples={t.examples_el ?? []}
        vocabulary={(t.vocabulary_items ?? []).map((v) => ({ lemma: v.lemma, inflection: v.inflection ?? '', meaning: v.meaning_ru ?? '', example: v.example ?? '' }))}
        steps={steps}
        retentionCount={retentionCount}
        qa={{ status: t.qa?.status ?? 'AUTO_VALIDATED', human: t.qa?.human_review ?? 'NOT_REVIEWED', audio: t.qa?.audio_review ?? 'MISSING_AUDIO' }}
        nextUnit={nextUnit ? { unit_id: nextUnit.unit_id, title_ru: nextUnit.title_ru } : null}
      />
    </section>
  );
}
