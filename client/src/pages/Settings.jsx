// Backup & restore. Export downloads your entire dataset (progress, streak,
// review schedule, authored challenges) as one versioned JSON file; import reads
// such a file back. Import defaults to a non-destructive merge; "replace" wipes
// existing state first and is confirmed before it runs.

import { useRef, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../state/auth.jsx';
import { useToast } from '../state/toast.jsx';

export default function Settings() {
  const { handleUnauthorized } = useAuth();
  const showToast = useToast();
  const fileRef = useRef(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Export: fetch the envelope and save it as a file, entirely client-side.
  async function onExport() {
    setError('');
    setMessage('');
    try {
      const envelope = await api.exportData();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pypocket-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (!handleUnauthorized(err)) setError('Could not export your data.');
    }
  }

  // Import: read the chosen file, parse it, and POST it in the selected mode.
  async function onFileChosen(e) {
    setError('');
    setMessage('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (replace && !window.confirm('Replace will erase your current progress, reviews, and authored challenges, then load the file. Continue?')) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      const res = await api.importData(envelope, replace ? 'replace' : 'merge');
      const s = res.summary;
      const skipped = s.skippedAuthored ? `, ${s.skippedAuthored} skipped` : '';
      setMessage(
        `Imported (${res.mode}): ${s.progress} progress, ${s.solveDays} days, ${s.reviews} reviews, ${s.authoredChallenges} authored${skipped}.`,
      );
      showToast('Import complete ✅');
    } catch (err) {
      if (!handleUnauthorized(err)) setError(err.message || 'Could not import that file.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // allow re-choosing the same file
    }
  }

  return (
    <>
      <AppHeader title="Backup & restore" back="/" />
      <main className="app-main stack">
        {error && <p className="error-text">{error}</p>}
        {message && (
          <div className="card" style={{ borderColor: 'var(--success)' }}>
            {message}
          </div>
        )}

        <div className="card stack">
          <strong>Export</strong>
          <p className="muted" style={{ margin: 0 }}>
            Download everything — progress, streak, review schedule, and your authored
            challenges — as a single JSON file.
          </p>
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            Download backup
          </button>
        </div>

        <div className="card stack">
          <strong>Import</strong>
          <p className="muted" style={{ margin: 0 }}>
            Restore from a backup file. By default this merges into your current data;
            tick “replace” to wipe first.
          </p>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              style={{ width: 'auto', minHeight: 0 }}
            />
            <span>Replace existing data</span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFileChosen}
            disabled={busy}
          />
        </div>
      </main>
    </>
  );
}
