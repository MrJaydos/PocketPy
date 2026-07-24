// The full list of challenges, grouped by topic in course order. Each row shows a
// status dot (solved / attempted / untouched) and a difficulty indicator.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';

/** Render difficulty 1..5 as filled/empty dots, e.g. ●●●○○. */
function Difficulty({ level }) {
  const dots = '●'.repeat(level) + '○'.repeat(5 - level);
  return (
    <span className="difficulty" aria-label={`Difficulty ${level} of 5`}>
      {dots}
    </span>
  );
}

// Human-friendly topic headings keyed by the topic slug used in the YAML.
const TOPIC_LABELS = {
  'syntax-variables': 'Syntax & Variables',
  'control-flow': 'Control Flow',
  lists: 'Lists',
  loops: 'Loops',
  functions: 'Functions',
  strings: 'Strings',
  dictionaries: 'Dictionaries',
  files: 'Files',
  classes: 'Classes',
  mixed: 'Mixed Challenges',
};

export default function ChallengeList() {
  const { handleUnauthorized } = useAuth();
  const [challenges, setChallenges] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listChallenges()
      .then(setChallenges)
      .catch((err) => {
        if (!handleUnauthorized(err)) setError('Could not load challenges.');
      });
  }, [handleUnauthorized]);

  // Preserve server order (already topic → order → difficulty) while grouping.
  const groups = [];
  if (challenges) {
    const index = new Map();
    for (const c of challenges) {
      if (!index.has(c.topic)) {
        index.set(c.topic, { topic: c.topic, items: [] });
        groups.push(index.get(c.topic));
      }
      index.get(c.topic).items.push(c);
    }
  }

  return (
    <>
      <AppHeader title="Challenges" back="/" showLogout />
      <main className="app-main">
        {error && <p className="error-text">{error}</p>}
        {!challenges && !error && <p className="muted">Loading…</p>}

        {groups.map((group) => (
          <section className="topic-group" key={group.topic}>
            <h2>{TOPIC_LABELS[group.topic] ?? group.topic}</h2>
            {group.items.map((c) => (
              <Link key={c.id} to={`/challenge/${c.id}`} style={{ textDecoration: 'none' }}>
                <button className="card challenge-item">
                  <span className={`status-dot ${c.status}`} aria-hidden="true" />
                  <span className="title">{c.title}</span>
                  <Difficulty level={c.difficulty} />
                </button>
              </Link>
            ))}
          </section>
        ))}
      </main>
    </>
  );
}
