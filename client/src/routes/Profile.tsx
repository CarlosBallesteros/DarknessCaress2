import { FormEvent, useEffect, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import * as authApi from "../api/auth";
import { ApiError } from "../api/request";
import { useAuth } from "../lib/auth";
import type { Meta } from "../types";
import "../styles/Profile.css";

export function Profile() {
  const { user, setUser } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [username, setUsername] = useState(user?.username ?? "");
  const [theme, setTheme] = useState(user?.theme ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");

  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [themeMsg, setThemeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void getMeta().then(setMeta);
  }, []);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setTheme(user.theme);
    }
  }, [user]);

  const onSaveUsername = async (e: FormEvent) => {
    e.preventDefault();
    setUsernameMsg(null);
    try {
      const res = await authApi.updateMe({ username });
      setUser(res.user);
      setUsernameMsg({ ok: true, text: "Username updated." });
    } catch (err) {
      setUsernameMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to update username.",
      });
    }
  };

  const onSaveTheme = async (e: FormEvent) => {
    e.preventDefault();
    setThemeMsg(null);
    try {
      const res = await authApi.updateMe({ theme });
      setUser(res.user);
      setThemeMsg({ ok: true, text: "Theme updated." });
    } catch (err) {
      setThemeMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to update theme.",
      });
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (newPassword !== repeatPassword) {
      setPasswordMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setPasswordMsg({ ok: true, text: "Password changed" });
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (err) {
      setPasswordMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to change password.",
      });
    }
  };

  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content profile-page visually-centered">
        <section className="card profile-card">
          <h2>Username</h2>
          <form onSubmit={onSaveUsername} className="profile-form">
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
            <button type="submit" className="primary-btn">
              Save
            </button>
          </form>
          {usernameMsg ? (
            <p className={usernameMsg.ok ? "success-text" : "error-banner"}>{usernameMsg.text}</p>
          ) : null}
        </section>

        <section className="card profile-card">
          <h2>Army theme</h2>
          <form onSubmit={onSaveTheme} className="profile-form">
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {(meta?.themes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" className="primary-btn">
              Save
            </button>
          </form>
          {themeMsg ? (
            <p className={themeMsg.ok ? "success-text" : "error-banner"}>{themeMsg.text}</p>
          ) : null}
        </section>

        <section className="card profile-card">
          <h2>Password</h2>
          <form onSubmit={onChangePassword} className="profile-form profile-form-vertical">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="Repeat new password"
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
            />
            <button type="submit" className="primary-btn">
              Save
            </button>
          </form>
          {passwordMsg ? (
            <p className={passwordMsg.ok ? "success-text" : "error-banner"}>{passwordMsg.text}</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
