// Shared top bar. A back/home link, a title, and (optionally) a logout button.

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';

/**
 * @param {{title: string, back?: string, showLogout?: boolean, action?: React.ReactNode}} props
 *   back — a path to navigate to when the ‹ button is tapped (omit for no button).
 *   action — optional element rendered on the right (e.g. a "Next" button).
 */
export default function AppHeader({ title, back, showLogout, action }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <header className="app-header">
      {back !== undefined ? (
        <button className="btn-ghost" aria-label="Back" onClick={() => navigate(back)}>
          ‹
        </button>
      ) : null}
      <h1>{title}</h1>
      <div className="spacer" />
      {action}
      {showLogout ? (
        <button className="btn-ghost" onClick={logout}>
          Log out
        </button>
      ) : null}
    </header>
  );
}
