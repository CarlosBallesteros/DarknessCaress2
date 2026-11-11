import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";
import { useUiMode } from "../hooks/useUiMode";
import { useUser } from "./UserContext";

const tabClass = ({ isActive }: { isActive: boolean }): string =>
  isActive ? "tab tab-active" : "tab";

// 05: left wordmark (clickable → /play), center tabs (active underlined
// gold), right ui-mode toggle + username + Log out. Wraps to two rows
// under 480 px.
export function TopMenu(): React.JSX.Element {
  const { user } = useUser();
  const { mode, toggle } = useUiMode();
  const navigate = useNavigate();

  const onLogout = (): void => {
    void logout().then(() => {
      navigate("/");
    });
  };

  return (
    <header className="top-menu">
      <NavLink to="/play" className="wordmark">
        Darkness Caress II
      </NavLink>
      <nav className="tabs" aria-label="Main">
        <NavLink to="/play" className={tabClass} data-testid="tab-game">
          Games
        </NavLink>
        <NavLink to="/stats" className={tabClass} data-testid="tab-stats">
          Statistics
        </NavLink>
        <NavLink to="/champions" className={tabClass} data-testid="tab-champions">
          Champions
        </NavLink>
        <NavLink to="/store" className={tabClass} data-testid="tab-store">
          Store
        </NavLink>
        <NavLink to="/profile" className={tabClass} data-testid="tab-profile">
          Profile
        </NavLink>
      </nav>
      <div className="menu-right">
        <button
          type="button"
          className="icon-btn"
          data-testid="ui-mode-toggle"
          aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
          onClick={toggle}
        >
          {mode === "dark" ? "☀" : "☾"}
        </button>
        <NavLink to="/profile" className="menu-username">
          {user.username}
        </NavLink>
        <button type="button" className="btn" data-testid="logout" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
