import { useEffect, useMemo, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import type { Meta } from "../types";
import { assetPath } from "../utils/assetPath";
import "../styles/Champions.css";

const CLASS_ORDER = ["sword", "axe", "spear", "archer", "mage", "healer"];

export function Champions() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await getMeta();
        if (!cancelled) setMeta(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const classes = useMemo(() => {
    if (!meta) return [];
    const keys = Object.keys(meta.classes);
    return keys.sort((a, b) => {
      const ia = CLASS_ORDER.indexOf(a);
      const ib = CLASS_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [meta]);

  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="champions-page">
        <h1>Champions</h1>
        {error ? <div className="error-banner">{error}</div> : null}
        {!meta ? <div className="spinner">Loading…</div> : null}
        {meta ? (
          <div className="champions-grid">
            {classes.map((key) => {
              const c = meta.classes[key];
              const theme = meta.themes[0]?.id ?? "warriors-europe";
              const pPlayer = assetPath("portrait", theme, key, "player");
              const pEnemy = assetPath("portrait", theme, key, "enemy");
              const fPlayer = assetPath("portrait-full", theme, key, "player");
              const fEnemy = assetPath("portrait-full", theme, key, "enemy");
              return (
                <article className="champion-card" key={key}>
                  <div className={`role-badge role-${c.role}`}>
                    {c.role === "attacker" ? "Attacker" : "Supporter"}
                  </div>
                  <div className="portraits-row">
                    <figure>
                      <button
                        type="button"
                        className="portrait-btn"
                        onClick={() => setLightbox({ src: fPlayer, alt: `${c.label} player` })}
                      >
                        <img
                          src={pPlayer}
                          alt={`${c.label} player portrait`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                      </button>
                      <figcaption className="side-label player">Player</figcaption>
                    </figure>
                    <figure>
                      <button
                        type="button"
                        className="portrait-btn"
                        onClick={() => setLightbox({ src: fEnemy, alt: `${c.label} enemy` })}
                      >
                        <img
                          src={pEnemy}
                          alt={`${c.label} enemy portrait`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                      </button>
                      <figcaption className="side-label enemy">Enemy</figcaption>
                    </figure>
                  </div>
                  <div className="champion-stats-block">
                    <h2>{c.label}</h2>
                    <ul>
                      <li>HP {c.hp}</li>
                      <li>ATK {c.atk}</li>
                      <li>DEF {c.def}</li>
                      <li>MOV {c.mov}</li>
                      <li>
                        RNG{" "}
                        {c.range.length
                          ? c.range.join(", ")
                          : c.healAmount
                            ? `Heal ${c.healAmount} (adj.)`
                            : "-"}
                      </li>
                      <li>Count {c.count}</li>
                    </ul>
                  </div>
                  <p className="champion-lore">{meta.lore[key] ?? ""}</p>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
      {lightbox ? (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt={lightbox.alt} />
        </div>
      ) : null}
    </main>
  );
}
