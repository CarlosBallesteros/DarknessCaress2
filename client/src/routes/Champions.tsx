import { useEffect, useState } from "react";
import { getMeta } from "../api/meta";
import { AssetImg } from "../components/AssetImg";
import type { AssetSide } from "../components/assets";
import type { ClassKey, MetaResponse } from "../types/api";
import { useUser } from "../components/UserContext";
import "../styles/champions.css";

interface Lightbox {
  classKey: ClassKey;
  side: AssetSide;
}

const ROLE_TEXT: Record<ClassMetaRole, string> = {
  attacker: "Attacker",
  supporter: "Supporter",
};
type ClassMetaRole = "attacker" | "supporter";

// 05: 6 class cards from GET /api/meta — role badge first, both portraits
// side-by-side (gold label player / red label enemy), class label overlaid on
// the stat block, lore text. Portrait click → lightbox (Esc/click closes).
export function Champions(): React.JSX.Element {
  const { user } = useUser();
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);

  useEffect(() => {
    void getMeta()
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (lightbox === null) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setLightbox(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (meta === null) {
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <section className="champions-page">
      <h1 className="display">Champions</h1>
      <div className="champion-grid">
        {(Object.keys(meta.classes) as ClassKey[]).map((classKey) => {
          const classMeta = meta.classes[classKey];
          return (
            <article key={classKey} className="card champion-card">
              <span className={`role-badge role-${classMeta.role}`}>
                {ROLE_TEXT[classMeta.role]}
              </span>
              <div className="champion-portraits">
                <button
                  type="button"
                  className="portrait-slot"
                  onClick={() => setLightbox({ classKey, side: "player" })}
                >
                  <AssetImg
                    themeId={user.theme}
                    kind="portrait"
                    classKey={classKey}
                    side="player"
                    alt={`${classMeta.label} — player side`}
                    className="portrait-img"
                  />
                  <span className="portrait-label label-player">player</span>
                </button>
                <button
                  type="button"
                  className="portrait-slot"
                  onClick={() => setLightbox({ classKey, side: "enemy" })}
                >
                  <AssetImg
                    themeId={user.theme}
                    kind="portrait"
                    classKey={classKey}
                    side="enemy"
                    alt={`${classMeta.label} — enemy side`}
                    className="portrait-img"
                  />
                  <span className="portrait-label label-enemy">enemy</span>
                </button>
              </div>
              <div className="champion-stats">
                <h3 className="display champion-name">{classMeta.label}</h3>
                <p>
                  HP {classMeta.hp} · Atk {classMeta.atk} · Def {classMeta.def}{" "}
                  · Mov {classMeta.mov}
                  {classMeta.range.length > 0
                    ? ` · Range ${classMeta.range.join("/")}`
                    : ""}
                  {classMeta.healAmount !== undefined
                    ? ` · Heals ${classMeta.healAmount}`
                    : ""}
                </p>
              </div>
              <p className="champion-lore">{meta.lore[classKey]}</p>
            </article>
          );
        })}
      </div>
      {lightbox !== null && (
        <div
          className="modal-overlay lightbox"
          role="presentation"
          onClick={() => setLightbox(null)}
          onKeyDown={undefined}
        >
          <div className="lightbox-body" role="dialog" aria-modal="true">
            <AssetImg
              themeId={user.theme}
              kind="portrait"
              classKey={lightbox.classKey}
              side={lightbox.side}
              alt={meta.classes[lightbox.classKey].label}
              className="lightbox-img"
            />
            <p className="display">{meta.classes[lightbox.classKey].label}</p>
          </div>
        </div>
      )}
    </section>
  );
}
