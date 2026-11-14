import { Navigate, Route, Routes } from "react-router-dom";
import { Champions } from "./Champions";
import { GameBoard } from "./GameBoard";
import { GameStrip } from "./GameStrip";
import { Landing } from "./Landing";
import { Login } from "./Login";
import { Profile } from "./Profile";
import { Register } from "./Register";
import { Statistics } from "./Statistics";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/play" element={<GameStrip />} />
      <Route path="/play/:gameId" element={<GameBoard />} />
      <Route path="/statistics" element={<Statistics />} />
      <Route path="/champions" element={<Champions />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
