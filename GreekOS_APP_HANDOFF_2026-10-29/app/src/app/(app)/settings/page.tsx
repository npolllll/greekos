import { requireUser } from '@/lib/auth';
import { serverClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { ENTRY_RU } from '@/lib/page';
import { asrStatus, ttsStatus } from '@/lib/providers/speech';
import { llmConfigured } from '@/lib/providers/llm';
import { SettingsClient } from './SettingsClient';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Настройки и приватность' };

export default async function SettingsPage() {
  const u = await requireUser();
  const supabase = await serverClient();
  const [{ data: consents }, { data: enr }, { data: prefs }] = await Promise.all([
    supabase.from('consents').select('consent_id, purpose, artifact_id, granted_at, expires_at, revoked_at').order('granted_at', { ascending: false }),
    adminClient().from('enrollments').select('start_date, end_date, exam_date, daily_minutes, days_per_week').eq('user_id', u.userId).maybeSingle(),
    adminClient().from('preferences').select('reduced_motion, speaking_rate').eq('user_id', u.userId).maybeSingle(),
  ]);
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Настройки</div><h1 className="screen-title">Настройки и приватность</h1><p className="screen-sub">{u.profile.display_name} · {u.email} · {u.profile.entry_path ? ENTRY_RU[u.profile.entry_path] : 'путь не выбран'} · {u.profile.timezone}</p></div></div>
      <div className="prog-grid">
        <div className="card cardpad">
          <div className="card-title"><Icon name="shield" /> Что видит владелец</div>
          <p className="small quiet">Владелец (owner_admin) видит ваш прогресс, время активности, ошибки с доказательствами, результаты диагностики, письма и экзаменов. Сырые записи голоса и полные расшифровки разговоров закрыты по умолчанию — доступ только по вашему отдельному согласию на конкретную запись, с ограниченным сроком и записью в журнал.</p>
          <div className="subtle-divider" />
          <div className="card-title"><Icon name="mic" /> Голос и данные</div>
          <ul className="criteria">
            <li>По умолчанию аудио с микрофона обрабатывается и не сохраняется.</li>
            <li>По желанию можно разрешить хранение записей для проверки — максимум 30 дней, отзыв удаляет записи сразу.</li>
            <li>Голос ассистента синтезирован (цифровой el-GR), это не запись носителя языка.</li>
            <li>Провайдеры: AI {llmConfigured() ? 'подключён' : 'не подключён'}, распознавание речи — {asrStatus().configured ? asrStatus().provider : 'не подключено'}, синтез — {ttsStatus().configured ? ttsStatus().provider : 'не подключён'}.</li>
          </ul>
        </div>
        <SettingsClient
          consents={(consents ?? []).map((c) => ({ ...c }))}
          enrollment={enr ? { daily_minutes: enr.daily_minutes, days_per_week: enr.days_per_week, exam_date: enr.exam_date, start_date: enr.start_date, end_date: enr.end_date } : null}
          reducedMotion={!!prefs?.reduced_motion}
          speakingRate={(prefs?.speaking_rate as 'slow' | 'normal') ?? 'normal'}
          isOwner={u.isOwner}
        />
      </div>
    </section>
  );
}
