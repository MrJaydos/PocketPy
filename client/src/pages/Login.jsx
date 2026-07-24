// The password gate. Single field, clear error, disabled while submitting.

import { useState } from 'react';
import { useAuth } from '../state/auth.jsx';
import { ApiError } from '../api/client.js';

export default function Login() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(password);
      // On success the AuthProvider flips status to 'in' and App re-renders.
    } catch (err) {
      // Show a friendly message. Rate-limit responses (429) get their own hint.
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a minute and try again.');
      } else {
        setError('Incorrect password.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={onSubmit}>
        <div>
          <h1>PyPocket</h1>
          <p className="muted">Enter your password to start practising.</p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          // Names help iOS/Android password managers offer to fill.
          name="password"
          aria-label="Password"
        />
        <p className="error-text" aria-live="polite">
          {error}
        </p>
        <button className="btn-primary" type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
