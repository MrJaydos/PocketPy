// "My challenges" — manage the challenges you've authored in-app. Authored challenges
// are merged into the same catalogue as the built-in ones, so once created they show
// up in the normal list and can be solved and reviewed like any other.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';

export default function AuthoredList() {
  const { handleUnauthorized } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listAuthored()
      .then(setItems)
      .catch((err) => {
        if (!handleUnauthorized(err)) setError('Could not load your challenges.');
      });
  }, [handleUnauthorized]);

  return (
    <>
      <AppHeader title="My challenges" back="/" />
      <main className="app-main stack">
        {error && <p className="error-text">{error}</p>}
        {!items && !error && <p className="muted">Loading…</p>}

        <Link to="/authored/new" style={{ textDecoration: 'none' }}>
          <button className="btn-primary" style={{ width: '100%' }}>
            ＋ New challenge
          </button>
        </Link>

        {items && items.length === 0 && (
          <p className="muted">
            You haven't authored any challenges yet. Create one and it'll appear in the
            main list alongside the built-in challenges.
          </p>
        )}

        {items && items.length > 0 && (
          <div className="stack">
            {items.map((c) => (
              <Link key={c.id} to={`/authored/${c.id}/edit`} style={{ textDecoration: 'none' }}>
                <button className="card challenge-item">
                  <span className="title">{c.title}</span>
                  <span className="difficulty">{c.topic}</span>
                </button>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
