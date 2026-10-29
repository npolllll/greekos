export function WeekBars({ week }: { week: Array<{ date: string; label: string; minutes: number }> }) {
  const max = Math.max(10, ...week.map((w) => w.minutes));
  return (
    <figure style={{ margin: 0 }} aria-label="Активные минуты по дням недели">
      <div className="mini-bars">
        {week.map((w, i) => (
          <div className="bar-wrap" key={w.date} title={`${w.label}: ${w.minutes} мин`}>
            <div className={`bar ${w.minutes > 0 && i === week.length - 1 ? 'active' : w.minutes >= max * 0.6 ? 'active' : ''}`} style={{ height: `${Math.max(4, Math.round((w.minutes / max) * 100))}%` }} />
          </div>
        ))}
      </div>
      <div className="bar-labels" aria-hidden="true">{week.map((w) => <span key={w.date}>{w.label}</span>)}</div>
      <figcaption className="sr-only">{week.map((w) => `${w.label} ${w.minutes} минут`).join(', ')}</figcaption>
    </figure>
  );
}
