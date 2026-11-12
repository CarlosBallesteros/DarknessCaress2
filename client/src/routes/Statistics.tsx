import { useEffect, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import { getStats } from "../api/games";
import type { Meta, Stats } from "../types";
import "../styles/Statistics.css";

export function Statistics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, m] = await Promise.all([getStats(), getMeta()]);
        if (!cancelled) {
          setStats(s);
          setMeta(m);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelFor = (id: string) => meta?.personalities[id]?.label ?? id;

  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="stats-page">
        <h1>Statistics</h1>
        {error ? <div className="error-banner">{error}</div> : null}
        {loading ? <div className="spinner">Loading…</div> : null}
        {!loading && stats && stats.gamesPlayed === 0 ? <p>Play your first battle.</p> : null}
        {!loading && stats ? (
          <>
            <div className="stats-totals">
              <div className="stat-big">
                <span className="stat-value">{stats.gamesPlayed}</span>
                <span className="stat-label">Games</span>
              </div>
              <div className="stat-big">
                <span className="stat-value">{(stats.winRate * 100).toFixed(1)}%</span>
                <span className="stat-label">Win rate</span>
              </div>
              <div className="stat-big">
                <span className="stat-value">{stats.wins}</span>
                <span className="stat-label">Wins</span>
              </div>
              <div className="stat-big">
                <span className="stat-value">{stats.losses}</span>
                <span className="stat-label">Losses</span>
              </div>
            </div>
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
                    <td>{labelFor(row.difficulty)}</td>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>
    </main>
  );
}
