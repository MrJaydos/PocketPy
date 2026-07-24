// A tiny toast system for brief, non-blocking feedback ("Solved! 🎉").
// One toast at a time is plenty for this app.

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((text, ms = 2500) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), ms);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message && (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
