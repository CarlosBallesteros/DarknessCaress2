import { Navigate, useLocation } from "react-router-dom";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const token = localStorage.getItem("dc_session");
  return token ? <>{children}</> : <Navigate to="/login" state={{ from: pathname }} replace />;
}
