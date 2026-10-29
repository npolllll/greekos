import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { localDateOf } from '@/lib/learning/calendar';
import { OnboardingForm } from './OnboardingForm';

export const metadata = { title: 'Начало обучения' };

export default async function WelcomePage() {
  const u = await requireUser();
  const { data } = await adminClient().from('enrollments').select('start_date').eq('user_id', u.userId).maybeSingle();
  if (data?.start_date) redirect('/');
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Начало</div><h1 className="screen-title">С чего начнём?</h1><p className="screen-sub">Это самоотчёт для выбора первого шага, а не уровень CEFR. Уровень по навыкам определяется заданиями.</p></div></div>
      <div className="placement-layout">
        <div className="card placement-panel">
          <OnboardingForm today={localDateOf(new Date(), u.profile.timezone)} defaultTz={u.profile.timezone} />
        </div>
        <aside className="card cardpad">
          <div className="card-title"><span>Как устроен маршрут</span></div>
          <div className="placement-feature">С нуля: алфавит → звуки и ударение → первые коммуникативные уроки A1.</div>
          <div className="placement-feature">С опытом: короткая многонавыковая диагностика. Сильные навыки не заставят повторять всё, слабые получат поддержку.</div>
          <div className="placement-feature">9 месяцев считаются от вашей даты начала. Дата экзамена — необязательная настройка и не сдвигает план.</div>
          <div className="placement-feature">Освоение засчитывается только по самостоятельным ответам и отсроченным проверкам D7 и D28.</div>
        </aside>
      </div>
    </section>
  );
}
