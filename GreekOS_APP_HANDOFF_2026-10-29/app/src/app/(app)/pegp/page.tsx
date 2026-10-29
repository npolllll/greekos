import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { pegpOverview } from '@/lib/modules/loaders';
import { Icon } from '@/components/Icon';
import './pegp.css';

export const metadata = { title: 'ΠΕΓΠ' };

interface WrittenPath { knowledge_questions?: number; knowledge_distribution?: Record<string, number>; reading_questions?: number; writing?: string; listening_questions?: number; listening_minutes?: number; speaking_minutes?: number; speaking_arrangement?: string; pass_conditions?: { knowledge_at_least?: number; language_at_least?: number; total_at_least?: number; all_conditions_required?: boolean } }

const BLOCKER_RU: Record<string, string> = {
  FULL_BANK_CONTENT_REVIEW: 'полная проверка банка вопросов',
  THIRD_PARTY_REPUBLICATION_RIGHTS: 'права на перепубликацию источников',
  HUMAN_FACT_AND_LANGUAGE_QA: 'проверка фактов и языка человеком',
  LANGUAGE_COMPONENT_AUTHORING: 'языковая часть (чтение, письмо, речь) не завершена',
  ACTUAL_AUDIO_AND_LISTENING_QA: 'реальное аудио и проверка аудирования',
};

export default async function PegpPage() {
  const u = await requireLearner();
  const o = await pegpOverview();
  const m = (o.moduleInfo ?? {}) as { status?: string; source_version?: string; ordinary_written_path?: WrittenPath; blockers?: string[] };
  const w = m.ordinary_written_path ?? {};
  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / ΠΕΓΠ</div><h1 className="screen-title">ΠΕΓΠ — гражданство</h1><p className="screen-sub">Отдельный маршрут: факты о Греции и язык для экзамена на гражданство. Не ΚΕΓ B2 и не уровень CEFR.</p></div>
        <span className="pill"><span className="dot" /> Банк {m.source_version?.split(';')[0] ?? '—'}</span>
      </div>
      <div className="banner warn"><Icon name="alert" /><span><strong>Правила и банк вопросов меняются.</strong> Каждый выпуск действует для конкретной сессии/даты; устаревший допуск закрывает задание. Это не юридическая консультация и не актуальные условия допуска к экзамену.</span></div>
      <div className="banner info"><Icon name="info" /><span>Факт и язык оцениваются раздельно; ошибка ударения ≠ неверный гражданский факт.</span></div>

      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Заданий в модуле</small><div className="metric mono">{o.totalMapped}</div><small className="quiet">сопоставлено с темами</small></div>
        <div className="card admin-stat"><small className="quiet">Доступно сейчас</small><div className="metric mono">{o.totalAvailable}</div><small className="quiet">выпущено и не просрочено</small></div>
        <div className="card admin-stat"><small className="quiet">Документы каталога</small><div className="metric mono">{o.catalog.total}</div><small className="quiet">снимок {o.catalog.snapshot ?? '—'}</small></div>
        <div className="card admin-stat"><small className="quiet">Темы без заданий</small><div className="metric mono">{o.catalog.pending}</div><small className="quiet">недоступны, не генерируются</small></div>
      </div>

      <div className="pegp-topics">
        {o.topics.map((t) => (
          <Link className="card pegp-topic" key={t.topic} href={`/pegp/${t.topic}`}>
            <span className="tag gray">{t.packets.map((p) => (p.kind === 'language_support' ? 'язык' : 'темы')).join(' + ') || 'темы'}</span>
            <h3>{t.topic}</h3>
            <div className="pegp-counts">
              <span className="tag blue">сопоставлено {t.mapped}</span>
              <span className={`tag ${t.available ? 'green' : 'gray'}`}>доступно {t.available}</span>
              {t.expired ? <span className="tag">допуск истёк: {t.expired}</span> : null}
            </div>
            <small className="quiet">{t.packets.map((p) => [p.packet_id.replace('PEGP-', ''), p.bank_version, p.date].filter(Boolean).join(' · ')).join(' | ')}</small>
          </Link>
        ))}
      </div>

      <div className="grid-2 mt16">
        <div className="card cardpad">
          <div className="card-title" style={{ marginBottom: 8 }}><Icon name="school" /> Формат обычного письменного пути</div>
          <dl className="kv">
            <dt>Вопросы на знания</dt><dd>{w.knowledge_questions ?? '—'} {w.knowledge_distribution ? `(${Object.entries(w.knowledge_distribution).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}</dd>
            <dt>Чтение</dt><dd>{w.reading_questions ?? '—'} вопросов</dd>
            <dt>Письмо</dt><dd>{w.writing ?? '—'}</dd>
            <dt>Аудирование</dt><dd>{w.listening_questions ?? '—'} вопросов{w.listening_minutes ? `, ${w.listening_minutes} мин` : ''}</dd>
            <dt>Говорение</dt><dd>{w.speaking_minutes ? `${w.speaking_minutes} мин` : '—'}{w.speaking_arrangement ? ` · ${w.speaking_arrangement}` : ''}</dd>
            <dt>Условия</dt><dd>{w.pass_conditions ? `знания ≥ ${w.pass_conditions.knowledge_at_least}, язык ≥ ${w.pass_conditions.language_at_least}, всего ≥ ${w.pass_conditions.total_at_least}${w.pass_conditions.all_conditions_required ? ', все условия обязательны' : ''}` : '—'}</dd>
          </dl>
          <p className="tiny muted mt8">Сведения из каталога проекта на дату снимка; актуальность официальных правил отдельно не перепроверялась.</p>
        </div>
        <div className="card cardpad">
          <div className="card-title" style={{ marginBottom: 8 }}><Icon name="lock" /> Что ещё не готово</div>
          <ul className="criteria">{(m.blockers ?? []).map((b) => <li key={b}>{BLOCKER_RU[b] ?? b}</li>)}{o.catalog.remaining_language.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </div>

      <div className="card cardpad mt16">
        <div className="card-title" style={{ marginBottom: 8 }}><Icon name="layers" /> Официальный каталог: покрытие</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Раздел каталога</th><th>Документов</th><th>Со ссылками на задания</th><th>Недоступно</th></tr></thead>
            <tbody>{o.catalog.families.map((f) => <tr key={f.family}><td lang="el"><strong>{f.family}</strong></td><td>{f.total}</td><td>{f.linked}</td><td>{f.pending}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="tiny muted mt8">Темы без сопоставленных заданий показываются как недоступные. Задания не создаются автоматически.</p>
        {u.isOwner ? (
          <details className="box mt8"><summary>Бэклог редактора ({o.catalog.pendingDocs.length} документов)</summary>
            <ul className="pegp-sources">{o.catalog.pendingDocs.map((d) => <li key={`${d.id}-${d.title}`} lang="el">{d.url ? <a href={d.url} target="_blank" rel="noreferrer noopener">{d.title}</a> : d.title}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
