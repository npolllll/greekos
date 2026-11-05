const LABEL: Record<string, string> = {
  lesson_started: 'Начат урок',
  lesson_completed: 'Урок завершён',
  exercise_submitted: 'Ответ сохранён',
  mistake_detected: 'Ошибка с доказательством',
  review_due: 'Пора повторить',
  delayed_review_passed: 'Отсроченная проверка пройдена',
  delayed_review_failed: 'Отсроченная проверка: нужно повторить',
  placement_updated: 'Диагностика обновлена',
  speaking_assessed: 'Разговор оценён',
  speaking_session_ended: 'Разговор сохранён',
  writing_assessed: 'Письмо оценено',
  exam_started: 'Начат экзаменационный компонент',
  exam_completed: 'Экзаменационный компонент сдан',
  content_approved: 'Материал выпущен',
  context_transfer_passed: 'Перенос в новой ситуации удался',
  competency_mastery_updated: 'Изменился статус навыка',
  route_changed: 'Маршрут изменён',
  profile_activated: 'Профиль активирован',
  appeal_opened: 'Оспорена оценка',
  appeal_resolved: 'Решение по оспариванию',
  activity: 'Активность',
};

const VERDICT: Record<string, string> = {
  CORRECT: 'верно', ACCEPTABLE_VARIANT: 'допустимый вариант', INCORRECT_CONFIRMED: 'ошибка', PENDING_REVIEW: 'на проверке',
  AMBIGUOUS: 'неоднозначно', ABSTAIN: 'без оценки', ASR_UNCERTAIN: 'распознавание неуверенно', NOT_ASSESSED: 'не оценивается',
};

export function EventFeed({ events }: { events: Array<{ id: number; event_type: string; occurred_at: string; payload: Record<string, unknown> }> }) {
  if (!events.length) return <div className="empty"><strong>Пока нет событий</strong>Первое событие появится после вашего первого ответа или урока.</div>;
  return (
    <div>
      {events.map((e) => {
        const v = typeof e.payload?.verdict === 'string' ? VERDICT[e.payload.verdict as string] : null;
        return (
          <div className="review-row" key={e.id}>
            <div>
              <b>{LABEL[e.event_type] ?? e.event_type}</b>
              <span className="event-text">{[v, e.payload?.preview ? 'предпросмотр' : null, typeof e.payload?.item_id === 'string' ? e.payload.item_id : null].filter(Boolean).join(' · ')}</span>
            </div>
            <small><time dateTime={e.occurred_at}>{new Date(e.occurred_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></small>
          </div>
        );
      })}
    </div>
  );
}
