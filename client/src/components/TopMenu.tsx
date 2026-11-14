import { Link, NavLink, useNavigate } from "react-router-dom";
import * as authApi from "../api/auth";
import { useAuth } from "../lib/auth";
import { useUiMode } from "../hooks/useUiMode";
import "../styles/TopMenu.css";

export function TopMenu() {
  const { user, setUser } = useAuth();
  const [mode, toggleMode] = useUiMode();
  const navigate = useNavigate();

  const onLogout = async () => {
    try {
      await authApi.logout();
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
      <nav className="top-menu-center" aria-label="Primary">
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
          className="icon-btn"
          data-testid="ui-mode-toggle"
          onClick={toggleMode}
          aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {mode === "dark" ? "☀" : "☾"}
        </button>
        {user ? (
          <>
            <Link to="/profile" className="username-link">
              {user.username}
            </Link>
            <button type="button" className="secondary-btn" data-testid="logout" onClick={onLogout}>
              Log out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
