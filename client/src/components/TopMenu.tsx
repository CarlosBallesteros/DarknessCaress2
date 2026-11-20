import { Link, NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";
import { useUiMode } from "../hooks/useUiMode";
import { useAuth } from "./useAuth";

export function TopMenu() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const { mode, toggle } = useUiMode();

  const onLogout = async () => {
    try {
      await logout();
    } finally {
      setUser(null);
      navigate("/");
    }
  };

  return (
    <header className="top-menu">
      <div className="top-menu-left">
        <Link to="/" className="wordmark" aria-label="Darkness Caress II home">
          Darkness Caress II
        </Link>
      </div>
      <nav className="top-menu-center" aria-label="Main tabs">
        <NavLink
          to="/play"
          data-testid="tab-game"
          className={({ isActive }) => (isActive ? "tab active" : "tab")}
        >
          Games
        </NavLink>
        <NavLink to="/stats" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          Statistics
        </NavLink>
        <NavLink to="/champions" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          Champions
        </NavLink>
        <NavLink
          to="/store"
          data-testid="tab-store"
          className={({ isActive }) => (isActive ? "tab active" : "tab")}
        >
          Store
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          Profile
        </NavLink>
      </nav>
      <div className="top-menu-right">
        <button
          type="button"
          className="icon-button"
          data-testid="ui-mode-toggle"
          onClick={toggle}
          aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {mode === "dark" ? "☀" : "☾"}
        </button>
        {user ? (
          <Link to="/profile" className="username-link" aria-label={`Profile (${user.username})`} title={user.username}>
            <span className="username-icon" aria-hidden="true">👤</span>
            <span className="username-text">{user.username}</span>
          </Link>
        ) : null}
        <button type="button" data-testid="logout" onClick={onLogout} className="logout-button">
          Log out
        </button>
      </div>
    </header>
  );
}
