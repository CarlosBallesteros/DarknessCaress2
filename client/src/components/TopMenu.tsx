import { Link } from "react-router-dom";

export function TopMenu() {
  return (
    <nav className="topmenu">
      <a className="logo" href="/">
        Darkness Caress II
      </a>
      <div className="tabs">
        <Link to="/play">Games</Link>
        <Link to="/statistics">Statistics</Link>
        <Link to="/champions">Champions</Link>
        <Link to="/profile">Profile</Link>
      </div>
    </nav>
  );
}
