import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { sectionItems } from '@/lib/learning/section-list';
import { llmConfigured } from '@/lib/providers/llm';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Письмо' };

export default async function WritingPage() {
  const u = await requireLearner();
  const items = await sectionItems('writing');
  const usable = items.filter((i) => i.access.learnerUsable);
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Письмо</div><h1 className="screen-title">Письмо</h1><p className="screen-sub">Оценивается фактический текст по критериям задания: выполнение задачи, содержание, язык и неопределённость — раздельно. Это учебная оценка, не официальный балл.</p></div>
        <Link className="btn outline" href="/exams">Письмо ΚΕΓ B2 <Icon name="arrow" size={14} /></Link></div>
      <div className="banner info"><Icon name="info" /><span>{llmConfigured() ? 'Автоматическая проверка по критериям подключена: она может воздержаться, если не уверена. Её цитаты всегда берутся из вашего текста.' : 'Автоматическая проверка по критериям не подключена: тексты сохраняются и ждут проверки без штрафа.'}</span></div>
      {!usable.length ? <div className="banner warn"><Icon name="lock" /><span><strong>Задания на письмо проходят проверку.</strong> Они откроются вместе с уроками.</span></div> : null}
      <div className="unit-list">
        {items.map((i) => (
          <Link key={i.dto.item_id} className="unit-row" href={i.access.learnerUsable ? `/practice/${encodeURIComponent(i.dto.item_id)}?context=writing` : u.isOwner ? `/practice/${encodeURIComponent(i.dto.item_id)}?context=writing&preview=1` : '/writing'} aria-disabled={!i.access.learnerUsable}>
            <span className="unit-num"><Icon name="pen" size={15} /></span>
            <div style={{ minWidth: 0 }}><h3>{i.unit?.title_ru ?? i.dto.item_id}</h3><p lang="el">{i.dto.prompt.slice(0, 120)}</p></div>
            <span className={`tag ${i.access.learnerUsable ? 'green' : 'gray'}`}>{i.access.learnerUsable ? i.dto.level : 'На проверке'}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
