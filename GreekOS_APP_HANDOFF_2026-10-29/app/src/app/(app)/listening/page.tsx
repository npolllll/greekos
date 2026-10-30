import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { sectionItems } from '@/lib/learning/section-list';
import { adminClient } from '@/lib/supabase/admin';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Аудирование' };

export default async function ListeningPage() {
  const u = await requireLearner();
  const items = await sectionItems('listening', u);
  const { count: verified } = await adminClient().from('audio_assets').select('id', { count: 'exact', head: true }).eq('digital_status', 'AUDIO_VERIFIED_DIGITAL').is('invalidated_at', null);
  const usable = items.filter((i) => i.access.learnerUsable);
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Аудирование</div><h1 className="screen-title">Аудирование</h1><p className="screen-sub">Только с реальным проверенным звуком. Транскрипт не заменяет прослушивание; без аудио задание не проводится и не оценивается.</p></div></div>
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Заданий на слух в курсе</small><div className="metric mono">{items.length}</div></div>
        <div className="card admin-stat"><small className="quiet">Доступны сейчас</small><div className="metric mono">{usable.length}</div></div>
        <div className="card admin-stat"><small className="quiet">Ждут аудио</small><div className="metric mono">{items.filter((i) => i.access.released && !i.access.audioReady).length}</div></div>
        <div className="card admin-stat"><small className="quiet">Цифровых аудио прошли QA</small><div className="metric mono">{verified ?? 0}</div></div>
      </div>
      {!usable.length ? <div className="banner warn"><Icon name="headphones" /><span><strong>Аудио пока недоступно.</strong> Очередь из 142 аудиозаданий озвучивается цифровым синтезом el-GR и проходит технические проверки до публикации. До этого раздел честно пуст.</span></div> : null}
      <div className="card cardpad">
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Урок</th><th>Задание</th><th>Статус</th><th /></tr></thead><tbody>
          {items.map((i) => (
            <tr key={i.dto.item_id}><td><strong>{i.unit?.title_ru ?? '—'}</strong><div className="tiny">{i.unit?.level}</div></td><td className="tiny" lang="el">{i.dto.prompt.slice(0, 90)}</td>
              <td>{i.access.learnerUsable ? <span className="status">Доступно</span> : i.access.reason === 'AUDIO_PENDING' ? <span className="status wait">Ждёт аудио</span> : <span className="status blocked">На проверке</span>}</td>
              <td>{i.access.learnerUsable || u.isOwner ? <Link href={`/practice/${encodeURIComponent(i.dto.item_id)}?context=lesson${i.access.learnerUsable ? '' : '&preview=1'}`}>{i.access.learnerUsable ? 'Слушать' : 'Предпросмотр'}</Link> : null}</td></tr>
          ))}
        </tbody></table></div>
      </div>
    </section>
  );
}
