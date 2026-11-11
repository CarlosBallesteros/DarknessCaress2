import { useEffect, useState } from "react";
import { getMeta, getStats } from "../api/meta";
import type { MetaResponse, StatsResponse } from "../types/api";
import "../styles/stats.css";

// 05: totals card (flat top-level numbers of GET /api/stats) + the
// per-difficulty table labeled via GET /api/meta. Empty state for 0 games.
export function Statistics(): React.JSX.Element {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void getStats()
      .then(setStats)
      .catch(() => setLoadError("Statistics are unavailable right now."));
    void getMeta()
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  if (stats === null || meta === null) {
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (loadError !== null) {
    return <p className="error-banner">{loadError}</p>;
  }
  if (stats.gamesPlayed === 0) {
    return <p className="stats-empty">Play your first battle.</p>;
  }

  return (
    <section className="stats-page">
      <h1 className="display">Statistics</h1>
      <div className="card stats-totals">
        <div className="stat-big">
          <span className="stat-number display">{stats.gamesPlayed}</span>
          <span className="stat-label">battles fought</span>
        </div>
        <div className="stat-big">
          <span className="stat-number display">
            {Math.round(stats.winRate * 100)}%
          </span>
          <span className="stat-label">win rate</span>
        </div>
        <div className="stat-big">
          <span className="stat-number display">{stats.wins}</span>
          <span className="stat-label">victories</span>
        </div>
        <div className="stat-big">
          <span className="stat-number display">{stats.losses}</span>
          <span className="stat-label">defeats</span>
        </div>
      </div>
      <table className="card stats-table">
        <thead>
          <tr>
            <th>Difficulty</th>
            <th>Played</th>
            <th>Wins</th>
            <th>Losses</th>
          </tr>
        </thead>
        <tbody>
          {stats.byDifficulty.map((row) => (
            <tr key={row.difficulty}>
              <td>
                {meta.personalities[row.difficulty]?.label ?? row.difficulty}
              </td>
              <td>{row.played}</td>
              <td>{row.wins}</td>
              <td>{row.losses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
