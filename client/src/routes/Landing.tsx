import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { me } from "../api/auth";
import { getMeta } from "../api/meta";
import { AssetImg } from "../components/AssetImg";
import "../styles/landing.css";

// 05: full-viewport hero, art via assetPath(DEFAULT_THEME, "hero") where
// DEFAULT_THEME = the first themes[].id served by the public GET /api/meta.
// Dark overlay regardless of UI mode. One Play button: → /play when
// authenticated, → /login otherwise.
export function Landing(): React.JSX.Element {
  const navigate = useNavigate();
  const [themeId, setThemeId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void getMeta()
      .then((meta) => setThemeId(meta.themes[0]?.id ?? null))
      .catch(() => undefined);
    void me()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);

  return (
    <div className="hero">
      {themeId !== null && (
        <AssetImg themeId={themeId} kind="hero" alt="" className="hero-art" />
      )}
      <div className="hero-overlay" aria-hidden />
      <div className="hero-content">
        <h1 className="display">Darkness Caress II</h1>
        <p className="tagline">The long awaited sequel to the legendary game</p>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="play"
          onClick={() => navigate(authenticated ? "/play" : "/login")}
        >
          Play
        </button>
      </div>
    </div>
  );
}
