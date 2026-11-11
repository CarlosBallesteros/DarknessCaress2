import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Champions } from "./routes/Champions";
import { GameBoard } from "./routes/GameBoard";
import { GameStrip } from "./routes/GameStrip";
import { Landing } from "./routes/Landing";
import { Login } from "./routes/Login";
import { Profile } from "./routes/Profile";
import { Register } from "./routes/Register";
import { Statistics } from "./routes/Statistics";

// Route table per 05. Authed routes share ProtectedRoute (me-check + TopMenu).
export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/play" element={<GameStrip />} />
          <Route path="/play/:id" element={<GameBoard />} />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/champions" element={<Champions />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
