import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../lib/auth";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { Landing } from "./Landing";
import { Login } from "./Login";
import { Register } from "./Register";
import { GameStrip } from "./GameStrip";
import { GameBoard } from "./GameBoard";
import { Statistics } from "./Statistics";
import { Champions } from "./Champions";
import { Profile } from "./Profile";
import { Store } from "./Store";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/play"
          element={
            <ProtectedRoute>
              <GameStrip />
            </ProtectedRoute>
          }
        />
        <Route
          path="/play/:id"
          element={
            <ProtectedRoute>
              <GameBoard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stats"
          element={
            <ProtectedRoute>
              <Statistics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/champions"
          element={
            <ProtectedRoute>
              <Champions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/store"
          element={
            <ProtectedRoute>
              <Store />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
