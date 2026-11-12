import { Link } from "react-router-dom";
import { assetPath } from "../utils/assetPath";
import { useAuth } from "../components/useAuth";
import "../styles/Landing.css";

export function Landing() {
  const { user } = useAuth();
  const hero = assetPath("hero");
  return (
    <main className="landing">
      <div
        className="landing-hero"
        style={{ backgroundImage: `url(${hero})` }}
        aria-hidden="true"
      />
      <div className="landing-overlay" />
      <div className="landing-content">
        <h1 className="landing-title">Darkness Caress II</h1>
        <p className="landing-tagline">The long-awaited sequel to the legendary game</p>
        <Link to={user ? "/play" : "/login"} className="landing-cta">
          To Battle!
        </Link>
      </div>
    </main>
  );
}
