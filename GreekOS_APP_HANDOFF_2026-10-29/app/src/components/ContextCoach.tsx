'use client';
import { useEffect, useState } from 'react';
import type { ItemDTO } from '@/lib/content/dto';
import { ItemPlayer } from './ItemPlayer';

interface ContextData {
  competencies: Array<{ competency_id: string; name: string; level: string }>;
  unit: { unit_id: string; title_ru: string; level: string } | null;
  situation: string | null;
  examples: string[];
  dialogue: string[];
  library: Array<{ id: string; type: string; text_el: string; translation_ru: string | null; notes_ru: string | null; register: string | null; quality: string }>;
  pronunciation: { status: string; reason: string };
  transfer: ItemDTO | null;
  provenance: string;
}

type Tab = 'situation' | 'dialogue' | 'pronunciation' | 'transfer';

/** v5.2 "Почему так?" — compact, on demand; only approved canonical material, never invented clips. */
export function ContextCoach({ attemptId, feedbackEventId, preview }: { attemptId: string; feedbackEventId: string | null; preview: boolean }) {
  const [data, setData] = useState<ContextData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('situation');

  useEffect(() => {
    fetch(`/api/feedback/${attemptId}/context`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setFailed(true));
  }, [attemptId]);

  if (failed) return <div className="context-coach"><p className="small">Разбор временно недоступен.</p></div>;
  if (!data) return <div className="context-coach" aria-busy="true"><div className="skeleton" /><div className="skeleton mt8" style={{ width: '70%' }} /></div>;

  const tabs: Array<[Tab, string]> = [['situation', 'Ситуация'], ['dialogue', 'Диалог'], ['pronunciation', 'Произношение'], ['transfer', 'Новое задание']];
  return (
    <div className="context-coach">
      <div className="context-eyebrow">ПОЧЕМУ ЭТО ВАЖНО · РАЗБОР В КОНТЕКСТЕ</div>
      <div className="context-head">
        <div>
          <h4>{data.competencies[0]?.name ?? 'Разбор задания'}</h4>
          <p>{data.unit ? `Урок «${data.unit.title_ru}» · ${data.unit.level}` : 'Объяснение из курса пока не выпущено'}</p>
        </div>
        <span className="tag">Авторский пример</span>
      </div>
      <div className="context-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`context-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="context-story" role="tabpanel">
        {tab === 'situation' ? (
          data.situation || data.examples.length || data.library.length ? (
            <>
              {data.situation ? <p className="theory" style={{ fontSize: 12.5 }}>{data.situation}</p> : null}
              {data.examples.slice(0, 2).map((e) => <div key={e} className="greek-serif" lang="el">{e}</div>)}
              {data.library.map((l) => (
                <div key={l.id} className="context-insight"><span lang="el" className="greek-serif" style={{ fontSize: 16 }}>{l.text_el}</span>{l.translation_ru ? <div>{l.translation_ru}</div> : null}{l.notes_ru ? <div className="tiny">{l.notes_ru}</div> : null}</div>
              ))}
            </>
          ) : <p>Для этой компетенции ещё нет выпущенного объяснения. Мы не подставляем непроверенные примеры.</p>
        ) : null}
        {tab === 'dialogue' ? (
          data.dialogue.length ? (
            <div className="mini-dialog">{data.dialogue.map((d) => <div key={d} lang="el" className="greek-serif" style={{ fontSize: 16 }}>{d}</div>)}<small>Смоделированная учебная ситуация, не запись реальных людей.</small></div>
          ) : <p>Проверенного диалога для этой темы пока нет.</p>
        ) : null}
        {tab === 'pronunciation' ? <p>{data.pronunciation.reason} Кнопка прослушивания появится только после цифровой проверки аудио.</p> : null}
        {tab === 'transfer' ? (
          data.transfer ? (
            <div>
              <p>Новое самостоятельное задание по той же теме (не исходный вопрос):</p>
              <ItemPlayer item={data.transfer} context="transfer" feedbackEventId={feedbackEventId ?? undefined} preview={preview} allowContext={false} compact />
            </div>
          ) : <p>Другого выпущенного задания по этой компетенции пока нет — перенос будет предложен, когда материал пройдёт проверку.</p>
        ) : null}
      </div>
      <p className="context-caption">{data.provenance} Отсроченные проверки D7 и D28 будут на другом материале.</p>
    </div>
  );
}
