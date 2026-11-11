import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/auth";
import { ApiError } from "../api/request";
import "../styles/register.css";

// Client checks per 01: email format, password ≥ 8, username 3–20 chars
// [a-zA-Z0-9_-], password repeat matches. Server messages surface verbatim.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function Register(): React.JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!USERNAME_RE.test(username)) {
      setError("Username must be 3–20 characters (letters, digits, - or _).");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== passwordAgain) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    void register({ email, password, username })
      .then(() => navigate("/play"))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Registration failed");
        setBusy(false);
      });
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1 className="display">Register</h1>
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
          Username
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Password again
          <input
            type="password"
            value={passwordAgain}
            autoComplete="new-password"
            onChange={(e) => setPasswordAgain(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Register
        </button>
        <p className="auth-link">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
