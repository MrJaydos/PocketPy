// The authoring form: create or edit a challenge. On edit, the id is fixed (it's the
// key for progress + review state, so it can't change). A "Test solution" button runs
// the reference solution against the tests in Pyodide — the same check the repo's
// validate:challenges script does — so you can't save a challenge whose own solution
// doesn't pass without at least being warned.

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import TestResults from '../components/TestResults.jsx';
import { usePyodide } from '../pyodide/usePyodide.js';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

/** Blank form state for a new challenge. */
const EMPTY = {
  id: '',
  title: '',
  topic: '',
  difficulty: 2,
  order: 0,
  description: '',
  starter_code: '',
  tests: '',
  hints: '', // one hint per line in the form; split into an array on save
  solution: '',
};

export default function AuthoredEdit() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { handleUnauthorized } = useAuth();
  const showToast = useToast();
  const { ready, busy, submit } = usePyodide();

  const [form, setForm] = useState(EMPTY);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState([]); // server-side validation messages
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load the existing challenge when editing.
  useEffect(() => {
    if (!isEdit) return;
    api
      .getAuthored(id)
      .then((c) => {
        setForm({
          id: c.id,
          title: c.title ?? '',
          topic: c.topic ?? '',
          difficulty: c.difficulty ?? 2,
          order: c.order ?? 0,
          description: c.description ?? '',
          starter_code: c.starter_code ?? '',
          tests: c.tests ?? '',
          hints: (c.hints ?? []).join('\n'),
          solution: c.solution ?? '',
        });
      })
      .catch((err) => {
        if (!handleUnauthorized(err)) setLoadError('Could not load this challenge.');
      });
  }, [id, isEdit, handleUnauthorized]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  /** Assemble the API payload from the form (hints text → array, numbers → numbers). */
  function toPayload() {
    return {
      id: form.id.trim(),
      title: form.title.trim(),
      topic: form.topic.trim(),
      difficulty: Number(form.difficulty),
      order: Number(form.order) || 0,
      description: form.description,
      starter_code: form.starter_code,
      tests: form.tests,
      hints: form.hints
        .split('\n')
        .map((h) => h.trim())
        .filter(Boolean),
      solution: form.solution,
    };
  }

  // Run the reference solution against the tests, right here in the browser.
  async function onTestSolution() {
    setTestResult(null);
    const result = await submit(form.solution, form.tests);
    setTestResult(result);
  }

  async function onSave() {
    setErrors([]);
    setSaving(true);
    const payload = toPayload();
    try {
      if (isEdit) {
        await api.updateAuthored(id, payload);
        showToast('Saved ✅');
      } else {
        await api.createAuthored(payload);
        showToast('Challenge created 🎉');
      }
      navigate('/authored');
    } catch (err) {
      if (handleUnauthorized(err)) return;
      // The server sends field-level messages in `details` for a 400.
      setErrors(err.details ?? [err.message]);
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('Delete this challenge? Your progress and review schedule for it will be removed too.')) {
      return;
    }
    try {
      await api.deleteAuthored(id);
      showToast('Deleted');
      navigate('/authored');
    } catch (err) {
      if (!handleUnauthorized(err)) showToast('Could not delete.');
    }
  }

  if (loadError) {
    return (
      <>
        <AppHeader title="Edit challenge" back="/authored" />
        <main className="app-main">
          <p className="error-text">{loadError}</p>
        </main>
      </>
    );
  }

  const passedItsOwnTests = testResult?.status === 'ok' && testResult.passed;

  return (
    <>
      <AppHeader title={isEdit ? 'Edit challenge' : 'New challenge'} back="/authored" />
      <main className="app-main stack">
        {errors.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--danger)' }}>
            <strong className="error-text">Couldn't save:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {errors.map((e, i) => (
                <li key={i} className="error-text" style={{ minHeight: 0 }}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="field">
          <span>Id (slug)</span>
          <input
            type="text"
            value={form.id}
            onChange={set('id')}
            disabled={isEdit}
            placeholder="e.g. strings-vowel-count"
          />
          {isEdit && <small className="muted">The id can't change after creation.</small>}
        </label>

        <label className="field">
          <span>Title</span>
          <input type="text" value={form.title} onChange={set('title')} />
        </label>

        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 2 }}>
            <span>Topic (slug)</span>
            <input type="text" value={form.topic} onChange={set('topic')} placeholder="e.g. strings" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Difficulty</span>
            <select value={form.difficulty} onChange={set('difficulty')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Description (Markdown)</span>
          <textarea className="code-input" rows={5} value={form.description} onChange={set('description')} />
        </label>

        <label className="field">
          <span>Starter code</span>
          <textarea className="code-input" rows={5} value={form.starter_code} onChange={set('starter_code')} />
        </label>

        <label className="field">
          <span>Tests</span>
          <textarea
            className="code-input"
            rows={6}
            value={form.tests}
            onChange={set('tests')}
            placeholder={'check(f(2) == 4, "f(2) should be 4")'}
          />
          <small className="muted">
            Use <code>check(condition, "message")</code> for each assertion.
          </small>
        </label>

        <label className="field">
          <span>Hints (one per line)</span>
          <textarea className="code-input" rows={3} value={form.hints} onChange={set('hints')} />
        </label>

        <label className="field">
          <span>Reference solution</span>
          <textarea className="code-input" rows={6} value={form.solution} onChange={set('solution')} />
        </label>

        {/* Verify the solution passes its own tests before saving. */}
        <div className="card stack">
          <div className="row">
            <button className="btn-ghost" onClick={onTestSolution} disabled={busy || !ready}>
              {ready ? 'Test solution' : 'Loading Python…'}
            </button>
            {passedItsOwnTests && <span className="muted">✅ Solution passes</span>}
          </div>
          <TestResults result={testResult} running={busy} />
        </div>

        <div className="row">
          <button className="btn-primary" onClick={onSave} disabled={saving} style={{ flex: 1 }}>
            {isEdit ? 'Save changes' : 'Create challenge'}
          </button>
          {isEdit && (
            <button className="btn-danger" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          )}
        </div>
      </main>
    </>
  );
}
