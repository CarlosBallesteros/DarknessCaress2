import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/auth";
import { ApiError } from "../types";
import { useAuth } from "../components/useAuth";
import "../styles/Register.css";

export function Register() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const clientError = useMemo(() => {
    if (password && password.length < 8) return "Password must be at least 8 characters.";
    if (passwordAgain && password !== passwordAgain) return "Passwords do not match.";
    if (username && (username.length < 3 || username.length > 20)) {
      return "Username must be 3â€“20 characters.";
    }
    if (username && !/^[a-zA-Z0-9_-]+$/.test(username)) {
      return "Username may contain letters, numbers, _ and - only.";
    }
    return null;
  }, [password, passwordAgain, username]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (clientError) {
      setError(clientError);
      return;
    }
    if (password !== passwordAgain) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await register({ email, password, username });
      setUser(res.user);
      navigate("/play", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <h1>Register</h1>
      <form onSubmit={onSubmit} className="auth-form">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={20}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          Password again
          <input
            type="password"
            value={passwordAgain}
            onChange={(e) => setPasswordAgain(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating accountâ€¦" : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
