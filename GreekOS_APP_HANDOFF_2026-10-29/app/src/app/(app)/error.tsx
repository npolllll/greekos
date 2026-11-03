'use client';

import Link from 'next/link';

/**
 * A screen that failed to render: the learner sees what happened and what to do, in Russian, inside the
 * app shell — not a blank page. The technical digest is shown for a support request; no data is lost
 * (answers and progress are saved on the server as they happen).
 */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="screen active">
      <div className="card cardpad standalone-card" role="alert">
        <div className="eyebrow">GreekOS · ошибка экрана</div>
        <h1 className="screen-title">Экран не загрузился</h1>
        <p className="screen-sub">Ответы и прогресс сохраняются на сервере сразу, поэтому ничего не потеряно. Попробуйте ещё раз; если повторится — напишите владельцу курса и укажите код ниже.</p>
        <div className="row mt16"><button className="btn" type="button" onClick={reset}>Попробовать снова</button><Link className="btn outline" href="/">На главную</Link></div>
        {error.digest ? <p className="tiny muted mt8">Код: <span className="mono">{error.digest}</span></p> : null}
      </div>
    </section>
  );
}
