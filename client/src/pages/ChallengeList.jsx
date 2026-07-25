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
  // Accordion: at most one topic open at a time. Defaults to the first topic
  // once challenges load; opening another closes the previous one.
  const [openTopic, setOpenTopic] = useState(null);

  useEffect(() => {
    api
      .listChallenges()
      .then((data) => {
        setChallenges(data);
        setOpenTopic((prev) => prev ?? data[0]?.topic ?? null);
      })
      .catch((err) => {
        if (!handleUnauthorized(err)) setError('Could not load challenges.');
      });
  }, [handleUnauthorized]);

  function toggleTopic(topic) {
    setOpenTopic((prev) => (prev === topic ? null : topic));
  }

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

        {groups.map((group) => {
          const total = group.items.length;
          const solved = group.items.filter((c) => c.status === 'solved').length;
          const isOpen = openTopic === group.topic;
          const done = solved === total;
          const panelId = `topic-${group.topic}`;
          return (
            <section className="topic-group" key={group.topic}>
              <button
                type="button"
                className="topic-header"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleTopic(group.topic)}
              >
                <span className={`chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                <span className="topic-name">{TOPIC_LABELS[group.topic] ?? group.topic}</span>
                <span className={`topic-count ${done ? 'done' : ''}`}>
                  {done ? '✓ ' : ''}
                  {solved}/{total}
                </span>
              </button>
              <div
                id={panelId}
                className={`topic-items-wrap ${isOpen ? 'open' : ''}`}
                inert={!isOpen}
              >
                <div className="topic-items">
                  {group.items.map((c) => (
                    <Link
                      key={c.id}
                      to={`/challenge/${c.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <button className="card challenge-item">
                        <span className={`status-dot ${c.status}`} aria-hidden="true" />
                        <span className="title">{c.title}</span>
                        <Difficulty level={c.difficulty} />
                      </button>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
