import type { CSSProperties } from "react";

// Persona label badge with the --persona-<id> accent (same tokens on game-strip
// cards and the board PhaseBanner, 05). Unknown ids fall back to gold.
export function PersonaBadge({
  personaId,
  label,
}: {
  personaId: string;
  label: string;
}): React.JSX.Element {
  const style = {
    "--persona-accent": `var(--persona-${personaId}, var(--gold))`,
  } as CSSProperties;
  return (
    <span className="persona-badge" style={style} data-persona={personaId}>
      {label}
    </span>
  );
}
