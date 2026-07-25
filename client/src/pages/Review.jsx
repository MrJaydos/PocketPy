// The spaced-repetition review screen. Challenges you've solved resurface here on a
// schedule (see services/review.js on the server). This page just lists what's due
// and hands off to the normal challenge screen in "review mode" (?review=1), where
// solving it reveals the Again / Good / Easy grading buttons.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';

/** Render difficulty 1..5 as filled/empty dots (matches the challenge list). */
function Difficulty({ level }) {
  return (
    <span className="difficulty" aria-label={`Difficulty ${level} of 5`}>
      {'●'.repeat(level) + '○'.repeat(5 - level)}
    </span>
  );
}

export default function Review() {
  const { handleUnauthorized } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .reviews()
      .then(setData)
      .catch((err) => {
        if (!handleUnauthorized(err)) setError('Could not load your reviews.');
      });
  }, [handleUnauthorized]);

  const due = data?.due ?? [];

  return (
    <>
      <AppHeader title="Review" back="/" />
      <main className="app-main stack">
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && due.length === 0 && (
          <div className="card">
            <p style={{ margin: 0 }}>🎉 All caught up — nothing due for review.</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Solve more challenges and they'll come back here on a spaced schedule.
            </p>
          </div>
        )}

        {due.length > 0 && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {due.length} {due.length === 1 ? 'challenge is' : 'challenges are'} due for review.
            </p>
            <button
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => navigate(`/challenge/${due[0].id}?review=1`)}
            >
              Start review
            </button>

            <div className="stack">
              {due.map((c) => (
                <Link
                  key={c.id}
                  to={`/challenge/${c.id}?review=1`}
                  style={{ textDecoration: 'none' }}
                >
                  <button className="card challenge-item">
                    <span className="status-dot solved" aria-hidden="true" />
                    <span className="title">{c.title}</span>
                    <Difficulty level={c.difficulty} />
                  </button>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
