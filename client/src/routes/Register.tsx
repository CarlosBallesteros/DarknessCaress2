import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as authApi from "../api/auth";
import { ApiError } from "../api/request";
import { useAuth } from "../lib/auth";
import "../styles/Register.css";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function Register() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clientValidationError = useMemo(() => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (!USERNAME_RE.test(username))
      return "Username must be 3-20 characters: letters, numbers, _ or -.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== passwordAgain) return "Passwords do not match.";
    return null;
  }, [email, username, password, passwordAgain]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (clientValidationError) {
      setError(clientValidationError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await authApi.register({ email, username, password });
      setUser(res.user);
      navigate("/play", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Registration failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card card">
        <h1>Register</h1>
        {error ? <div className="error-banner">{error}</div> : null}
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Password again
            <input
              type="password"
              value={passwordAgain}
              onChange={(e) => setPasswordAgain(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary-btn" disabled={submitting}>
            Create account
          </button>
        </form>
        <p className="auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
