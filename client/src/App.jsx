// Top-level app: decides between the login screen and the authenticated app, and
// defines the routes. Kept declarative and small — each screen is its own page
// component.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './state/auth.jsx';
import { ToastProvider } from './state/toast.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import ChallengeList from './pages/ChallengeList.jsx';
import Challenge from './pages/Challenge.jsx';
import Review from './pages/Review.jsx';
import AuthoredList from './pages/AuthoredList.jsx';
import AuthoredEdit from './pages/AuthoredEdit.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const { status } = useAuth();

  // While we check the session cookie, render a minimal placeholder to avoid a
  // flash of the login screen for already-logged-in users.
  if (status === 'loading') {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (status === 'out') {
    return <Login />;
  }

  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/challenges" element={<ChallengeList />} />
        <Route path="/review" element={<Review />} />
        <Route path="/authored" element={<AuthoredList />} />
        <Route path="/authored/new" element={<AuthoredEdit />} />
        <Route path="/authored/:id/edit" element={<AuthoredEdit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/challenge/:id" element={<Challenge />} />
        {/* Anything unknown goes home. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
