import { FormEvent, useEffect, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import { changePassword, patchMe } from "../api/auth";
import { useAuth } from "../components/useAuth";
import type { Meta } from "../types";
import { ApiError } from "../types";
import "../styles/Profile.css";

export function Profile() {
  const { user, setUser } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);

  const [username, setUsername] = useState(user?.username ?? "");
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [theme, setTheme] = useState(user?.theme ?? "");
  const [themeMsg, setThemeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setUsername(user?.username ?? "");
    setTheme(user?.theme ?? "");
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getMeta();
        if (!cancelled) setMeta(m);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaveUsername = async (e: FormEvent) => {
    e.preventDefault();
    setUsernameMsg(null);
    try {
      const res = await patchMe({ username });
      setUser(res.user);
      setUsernameMsg({ ok: true, text: "Username updated." });
    } catch (err) {
      setUsernameMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to update username",
      });
    }
  };

  const onSaveTheme = async (e: FormEvent) => {
    e.preventDefault();
    setThemeMsg(null);
    try {
      const res = await patchMe({ theme });
      setUser(res.user);
      setThemeMsg({ ok: true, text: "Theme updated." });
    } catch (err) {
      setThemeMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to update theme",
      });
    }
  };

  const onSavePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== repeatPassword) {
      setPasswordMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordMsg({ ok: true, text: "Password changed" });
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
    } catch (err) {
      setPasswordMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "Failed to change password",
      });
    }
  };

  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="profile-page">
        <h1>Profile</h1>
        <div className="profile-cards">
          <form className="profile-card" onSubmit={onSaveUsername}>
            <h2>Username</h2>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={20}
              />
            </label>
            {usernameMsg ? (
              <p className={usernameMsg.ok ? "success-text" : "error-banner"}>{usernameMsg.text}</p>
            ) : null}
            <button type="submit">Save</button>
          </form>

          <form className="profile-card" onSubmit={onSaveTheme}>
            <h2>Army theme</h2>
            <label>
              Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {meta?.themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {themeMsg ? (
              <p className={themeMsg.ok ? "success-text" : "error-banner"}>{themeMsg.text}</p>
            ) : null}
            <button type="submit">Save</button>
          </form>

          <form className="profile-card" onSubmit={onSavePassword}>
            <h2>Password</h2>
            <label>
              Current password
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <label>
              Repeat new password
              <input
                type="password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            {passwordMsg ? (
              <p className={passwordMsg.ok ? "success-text" : "error-banner"}>{passwordMsg.text}</p>
            ) : null}
            <button type="submit">Save</button>
          </form>
        </div>
      </section>
    </main>
  );
}
