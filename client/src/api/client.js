// Thin wrapper around fetch for talking to our backend.
//
// Everything goes through apiFetch so we have one place that:
//   - sends cookies (credentials: 'include') for the session,
//   - sets JSON headers,
//   - turns non-2xx responses into thrown errors with the server's message,
//   - surfaces a 401 so the app can bounce the user to the login screen.

/** Error thrown for any non-OK API response. Carries the HTTP status. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * @param {string} path e.g. '/api/challenges'
 * @param {RequestInit & { json?: unknown }} [options]
 */
export async function apiFetch(path, options = {}) {
  const { json, headers, ...rest } = options;
  const res = await fetch(path, {
    credentials: 'include', // always send the session cookie
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    ...rest,
  });

  // 204 / empty bodies.
  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- Typed-ish helpers for each endpoint (thin, self-documenting) ------------

export const api = {
  me: () => apiFetch('/api/auth/me'),
  login: (password) => apiFetch('/api/auth/login', { method: 'POST', json: { password } }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),

  listChallenges: () => apiFetch('/api/challenges'),
  getChallenge: (id) => apiFetch(`/api/challenges/${encodeURIComponent(id)}`),
  saveDraft: (id, code) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/draft`, { method: 'PUT', json: { code } }),
  recordAttempt: (id) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/attempt`, { method: 'POST' }),
  recordSolve: (id) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/solve`, { method: 'POST' }),
  revealHint: (id, index) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/hint`, { method: 'POST', json: { index } }),
  revealSolution: (id, giveUp) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/reveal-solution`, {
      method: 'POST',
      json: { giveUp },
    }),

  // Phase 2 server-run challenges (runner: "server"): code executes in the sandboxed
  // runner container and grading happens on the server.
  runServer: (id, code) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/run-server`, {
      method: 'POST',
      json: { code },
    }),
  submitServer: (id, code) =>
    apiFetch(`/api/challenges/${encodeURIComponent(id)}/submit-server`, {
      method: 'POST',
      json: { code },
    }),

  progress: () => apiFetch('/api/progress'),
};
