// The dashboard / home screen. Shows the streak, a "continue where you left off"
// shortcut, overall progress, and per-topic bars. All numbers come from the backend
// /api/progress endpoint (see services/progress.js).

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import StreakFlame from '../components/StreakFlame.jsx';
import TopicBar from '../components/TopicBar.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';

export default function Home() {
  const { handleUnauthorized } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .progress()
      .then(setData)
      .catch((err) => {
        if (!handleUnauthorized(err)) setError('Could not load your progress.');
      });
  }, [handleUnauthorized]);

  return (
    <>
      <AppHeader title="PyPocket" showLogout />
      <main className="app-main stack">
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && (
          <>
            <StreakFlame current={data.streak.current} longest={data.streak.longest} />

            {/* Continue where you left off */}
            {data.lastChallengeId ? (
              <Link to={`/challenge/${data.lastChallengeId}`} style={{ textDecoration: 'none' }}>
                <button className="btn-primary" style={{ width: '100%' }}>
                  Continue: {data.lastChallengeId}
                </button>
              </Link>
            ) : (
              <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/challenges')}>
                Start your first challenge
              </button>
            )}

            {/* Overall progress */}
            <div className="card">
              <div className="row">
                <strong>
                  {data.totals.solved} / {data.totals.total} solved
                </strong>
                <div className="spacer" />
                <span className="muted">{data.totals.remaining} to go</span>
              </div>
            </div>

            {/* Per-topic bars */}
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: '1rem' }}>By topic</h2>
              {data.perTopic.map((t) => (
                <TopicBar key={t.topic} {...t} />
              ))}
            </div>

            <Link to="/challenges" style={{ textDecoration: 'none' }}>
              <button style={{ width: '100%' }}>Browse all challenges</button>
            </Link>
          </>
        )}
      </main>
    </>
  );
}
