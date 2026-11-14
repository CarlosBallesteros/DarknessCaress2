import { useNavigate } from "react-router-dom";
import { assetPath } from "../lib/assetPath";
import { useAuth } from "../lib/auth";
import "../styles/Landing.css";

export function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const hero = assetPath("hero");

  const onBattle = () => {
    if (user) navigate("/play");
    else navigate("/login");
  };

  return (
    <main className="landing" style={{ ["--hero-url" as string]: `url(${hero})` }}>
      <div className="landing-hero" aria-hidden="true" />
      <div className="landing-overlay" aria-hidden="true" />
      <div className="landing-content">
        <h1 className="landing-title">Darkness Caress II</h1>
        <p className="landing-tagline">The long-awaited sequel to the legendary game</p>
        <button
          type="button"
          className="primary-btn landing-cta"
          onClick={onBattle}
          disabled={loading}
        >
          To Battle!
        </button>
      </div>
    </main>
  );
}
