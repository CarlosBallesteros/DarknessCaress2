import { useEffect, useState } from "react";
import { TopMenu } from "../components/TopMenu";
import { getMeta } from "../api/meta";
import { assetPath } from "../lib/assetPath";
import { useAuth } from "../lib/auth";
import type { ClassKey, Meta } from "../types";
import "../styles/Champions.css";

type LightboxState = { classKey: ClassKey; side: "player" | "enemy"; label: string } | null;

export function Champions() {
  const { user } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  useEffect(() => {
    let cancelled = false;
    void getMeta().then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const themeId = user?.theme || meta?.themes[0]?.id || "warriors-europe";
  const classKeys = (meta ? (Object.keys(meta.classes) as ClassKey[]) : []) as ClassKey[];

  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content champions-page">
        {!meta ? (
          <div className="spinner">Loading…</div>
        ) : (
          <div className="champions-grid">
            {classKeys.map((classKey) => {
              const cls = meta.classes[classKey];
              const lore = meta.lore[classKey] ?? "";
              return (
                <article key={classKey} className="card champion-card">
                  <div className={`role-badge ${cls.role}`}>
                    {cls.role === "attacker" ? "Attacker" : "Supporter"}
                  </div>
                  <div className="champion-portraits">
                    <button
                      type="button"
                      className="portrait-btn"
                      onClick={() =>
                        setLightbox({ classKey, side: "player", label: `${cls.label} (Player)` })
                      }
                    >
                      <img
                        src={assetPath("portrait", themeId, classKey, "player")}
                        alt={`${cls.label} player portrait`}
                      />
                      <span className="portrait-label player">Player</span>
                    </button>
                    <button
                      type="button"
                      className="portrait-btn"
                      onClick={() =>
                        setLightbox({ classKey, side: "enemy", label: `${cls.label} (Enemy)` })
                      }
                    >
                      <img
                        src={assetPath("portrait", themeId, classKey, "enemy")}
                        alt={`${cls.label} enemy portrait`}
                      />
                      <span className="portrait-label enemy">Enemy</span>
                    </button>
                  </div>
                  <div className="champion-stats-block">
                    <h2 className="champion-label">{cls.label}</h2>
                    <div className="champion-stats">
                      <span>HP {cls.hp}</span>
                      <span>ATK {cls.atk}</span>
                      <span>DEF {cls.def}</span>
                      <span>MOV {cls.mov}</span>
                      <span>
                        {cls.healAmount
                          ? `Heal ${cls.healAmount}`
                          : `RNG ${cls.range.join(",") || "-"}`}
                      </span>
                    </div>
                  </div>
                  <p className="champion-lore">{lore}</p>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {lightbox ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setLightbox(null)}>
          <div className="lightbox" onClick={(e) => e.stopPropagation()}>
            <img
              src={assetPath("portrait-full", themeId, lightbox.classKey, lightbox.side)}
              alt={lightbox.label}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
