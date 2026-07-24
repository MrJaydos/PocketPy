// The streak "flame" shown on the dashboard. A cold streak (0) shows a grey ember
// so it's clear the feature exists and how to light it.

export default function StreakFlame({ current, longest }) {
  return (
    <div className="card">
      <div className="streak-flame">
        <span className="emoji" aria-hidden="true">
          {current > 0 ? '🔥' : '🧊'}
        </span>
        <span>{current}</span>
        <span className="muted" style={{ fontSize: '1rem' }}>
          day{current === 1 ? '' : 's'}
        </span>
      </div>
      <p className="muted" style={{ margin: '6px 0 0' }}>
        {current > 0
          ? 'Solve one challenge today to keep it going.'
          : 'Solve a challenge to start a streak.'}
        {longest > 0 ? ` Longest: ${longest} days.` : ''}
      </p>
    </div>
  );
}
