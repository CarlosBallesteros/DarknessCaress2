import { useEffect, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import { getStats } from "../api/stats";
import type { Meta, Stats } from "../types";
import "../styles/Statistics.css";

export function Statistics() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, s] = await Promise.all([getMeta(), getStats()]);
        if (!cancelled) {
          setMeta(m);
          setStats(s);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content stats-page">
        {loading || !stats ? (
          <div className="spinner">Loading…</div>
        ) : stats.gamesPlayed === 0 ? (
          <section className="card stats-empty">Play your first battle.</section>
        ) : (
          <>
            <section className="card stats-totals">
              <div className="stats-total-item">
                <div className="stats-big">{stats.gamesPlayed}</div>
                <div className="stats-label">Games played</div>
              </div>
              <div className="stats-total-item">
                <div className="stats-big">{Math.round(stats.winRate * 100)}%</div>
                <div className="stats-label">Win rate</div>
              </div>
              <div className="stats-total-item">
                <div className="stats-big">
                  {stats.wins} / {stats.losses}
                </div>
                <div className="stats-label">Wins / Losses</div>
              </div>
            </section>
            <section className="card">
              <h2>By difficulty</h2>
              <div className="table-wrap">
                <table className="stats-table">
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
                        <td>{meta?.personalities[row.difficulty]?.label ?? row.difficulty}</td>
                        <td>{row.played}</td>
                        <td>{row.wins}</td>
                        <td>{row.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
