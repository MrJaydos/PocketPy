// Shared top bar. A back/home link, a title, and (optionally) a logout button.

import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';

/**
 * @param {{title: string, back?: string, showLogout?: boolean, action?: React.ReactNode, titleHref?: string}} props
 *   back — a path to navigate to when the ‹ button is tapped (omit for no button).
 *   action — optional element rendered on the right (e.g. a "Next" button).
 *   titleHref — if set, the title becomes a link to this path (e.g. the brand
 *     name linking back to the homepage).
 */
export default function AppHeader({ title, back, showLogout, action, titleHref }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <header className="app-header">
      {back !== undefined ? (
        <button className="btn-ghost" aria-label="Back" onClick={() => navigate(back)}>
          ‹
        </button>
      ) : null}
      {titleHref ? (
        <Link to={titleHref} className="app-header-title-link">
          <h1>{title}</h1>
        </Link>
      ) : (
        <h1>{title}</h1>
      )}
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
