import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { patchMe, patchPassword } from "../api/auth";
import { ApiError } from "../api/request";
import { getMeta } from "../api/meta";
import { useUser } from "../components/UserContext";
import type { MetaResponse } from "../types/api";
import "../styles/profile.css";

// Three cards, own submit button, inline success/error text — never browser
// alerts (05).
export function Profile(): React.JSX.Element {
  const { user, setUser } = useUser();
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  const [username, setUsername] = useState(user.username);
  const [usernameNote, setUsernameNote] = useState<string | null>(null);

  const [theme, setTheme] = useState(user.theme);
  const [themeNote, setThemeNote] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [passwordNote, setPasswordNote] = useState<string | null>(null);

  useEffect(() => {
    void getMeta()
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  const saveUsername = (e: FormEvent): void => {
    e.preventDefault();
    setUsernameNote(null);
    void patchMe({ username })
      .then((u) => {
        setUser(u); // success updates the top-menu username (05)
        setUsernameNote("Username changed.");
      })
      .catch((err: unknown) =>
        setUsernameNote(
          err instanceof ApiError
            ? err.message
            : "Could not change the username.",
        ),
      );
  };

  const saveTheme = (e: FormEvent): void => {
    e.preventDefault();
    setThemeNote(null);
    void patchMe({ theme })
      .then((u) => {
        setUser(u);
        setThemeNote("Theme changed.");
      })
      .catch((err: unknown) =>
        setThemeNote(
          err instanceof ApiError ? err.message : "Could not change the theme.",
        ),
      );
  };

  const savePassword = (e: FormEvent): void => {
    e.preventDefault();
    setPasswordNote(null);
    if (newPassword.length < 8) {
      setPasswordNote("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== passwordAgain) {
      setPasswordNote("New passwords do not match.");
      return;
    }
    void patchPassword(currentPassword, newPassword)
      .then(() => {
        setPasswordNote("Password changed");
        setCurrentPassword("");
        setNewPassword("");
        setPasswordAgain("");
      })
      .catch((err: unknown) =>
        setPasswordNote(
          err instanceof ApiError
            ? err.message
            : "Could not change the password.",
        ),
      );
  };

  const noteClass = (note: string | null): string =>
    note === null
      ? ""
      : note.endsWith("changed")
        ? "inline-ok"
        : "inline-error";

  return (
    <section className="profile-page">
      <h1 className="display">Profile</h1>
      <form className="card profile-card" onSubmit={saveUsername}>
        <h2 className="display">Username</h2>
        <label>
          Username
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        {usernameNote !== null && (
          <p className={noteClass(usernameNote)}>{usernameNote}</p>
        )}
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>

      <form className="card profile-card" onSubmit={saveTheme}>
        <h2 className="display">Army theme</h2>
        <label>
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            {(meta?.themes ?? [{ id: user.theme, label: user.theme }]).map(
              (t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ),
            )}
          </select>
        </label>
        {themeNote !== null && (
          <p className={noteClass(themeNote)}>{themeNote}</p>
        )}
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>

      <form className="card profile-card" onSubmit={savePassword}>
        <h2 className="display">Password</h2>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Repeat new password
          <input
            type="password"
            value={passwordAgain}
            autoComplete="new-password"
            onChange={(e) => setPasswordAgain(e.target.value)}
            required
          />
        </label>
        {passwordNote !== null && (
          <p className={noteClass(passwordNote)}>{passwordNote}</p>
        )}
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>
    </section>
  );
}
