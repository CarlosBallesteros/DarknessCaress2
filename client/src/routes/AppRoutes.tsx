import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "../components/AuthContext";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { Champions } from "./Champions";
import { GameBoard } from "./GameBoard";
import { GameStrip } from "./GameStrip";
import { Landing } from "./Landing";
import { Login } from "./Login";
import { Profile } from "./Profile";
import { Register } from "./Register";
import { Statistics } from "./Statistics";
import { Store } from "./Store";

export function AppRoutes() {
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
      </Routes>
    </AuthProvider>
  );
}
