import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import * as authApi from "../api/auth";
import { ApiError } from "../api/request";
import { useAuth } from "../lib/auth";
import "../styles/Login.css";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || "/play";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.login({ email, password });
      setUser(res.user);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Login failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card card">
        <h1>Log in</h1>
        {error ? <div className="error-banner">{error}</div> : null}
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <button type="submit" className="primary-btn" disabled={submitting}>
            Log in
          </button>
        </form>
        <p className="auth-alt">
          Need an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </main>
  );
}
