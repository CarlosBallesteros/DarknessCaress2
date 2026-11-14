import { Navigate, Route, Routes } from "react-router-dom";
import { Landing } from "./Landing";
import { Login } from "./Login";
import { Register } from "./Register";
import { GameStrip } from "./GameStrip";
import { GameBoard } from "./GameBoard";
import { Statistics } from "./Statistics";
import { Champions } from "./Champions";
import { Profile } from "./Profile";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/play" element={<GameStrip />} />
      <Route path="/play/:id" element={<GameBoard />} />
      <Route path="/statistics" element={<Statistics />} />
      <Route path="/champions" element={<Champions />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
