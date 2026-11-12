import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Landing } from "./routes/Landing";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { GameStrip } from "./routes/GameStrip";
import { GameBoard } from "./routes/GameBoard";
import { Statistics } from "./routes/Statistics";
import { Champions } from "./routes/Champions";
import { Profile } from "./routes/Profile";
import { ProtectedRoute } from "./components/ProtectedRoute";

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  {
    path: "/play",
    element: (
      <ProtectedRoute>
        <GameStrip />
      </ProtectedRoute>
    ),
  },
  {
    path: "/play/:gameId",
    element: (
      <ProtectedRoute>
        <GameBoard />
      </ProtectedRoute>
    ),
  },
  {
    path: "/statistics",
    element: (
      <ProtectedRoute>
        <Statistics />
      </ProtectedRoute>
    ),
  },
  {
    path: "/champions",
    element: (
      <ProtectedRoute>
        <Champions />
      </ProtectedRoute>
    ),
  },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <Profile />
      </ProtectedRoute>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
