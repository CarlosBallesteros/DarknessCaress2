import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { ApiError } from "../api/request";
import "../styles/login.css";

// 05: email + password form, error banner on 401/429, link to /register.
export function Login(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const back = (location.state as { from?: string } | null)?.from ?? "/play";

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    void login(email, password)
      .then(() => navigate(back))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Login failed");
        setBusy(false);
      });
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1 className="display">Log in</h1>
        {error !== null && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Log in
        </button>
        <p className="auth-link">
          No account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
