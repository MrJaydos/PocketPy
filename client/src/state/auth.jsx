// Authentication state, shared across the app via React context.
//
// On first load we ask the backend "am I logged in?" (the cookie is httpOnly so JS
// can't read it directly). While we wait we show nothing; then the router shows
// either the login screen or the app.

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'in' | 'out'

  // Check session on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => !cancelled && setStatus(r.authenticated ? 'in' : 'out'))
      .catch(() => !cancelled && setStatus('out'));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (password) => {
    await api.login(password); // throws ApiError on wrong password
    setStatus('in');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setStatus('out');
    }
  }, []);

  // If any request 401s elsewhere, callers can flip us back to logged-out.
  const handleUnauthorized = useCallback((err) => {
    if (err instanceof ApiError && err.status === 401) {
      setStatus('out');
      return true;
    }
    return false;
  }, []);

  const value = { status, login, logout, handleUnauthorized };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
