import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { me } from "../api/auth";
import type { User } from "../types/api";
import { TopMenu } from "./TopMenu";
import { UserContext } from "./UserContext";

// 05: on mount calls GET /api/me; on 401 redirects to /login with a state
// back-link; while loading a minimal spinner and nothing else.
export function ProtectedRoute(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [rejected, setRejected] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    void me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        if (alive) setRejected(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (rejected) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (user === null) {
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  return (
    <UserContext.Provider value={{ user, setUser }}>
      <TopMenu />
      <main className="page">
        <Outlet />
      </main>
    </UserContext.Provider>
  );
}
