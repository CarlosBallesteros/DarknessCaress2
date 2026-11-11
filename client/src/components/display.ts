import type { ClassKey, MetaResponse, Unit } from "../types/api";

// 00: the UI lists units in this default display order —
// Swords, Axes, Spears, Archers, Mage, Healer.
export const DISPLAY_ORDER: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];

export function sortForDisplay(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => {
    const ca = DISPLAY_ORDER.indexOf(a.class);
    const cb = DISPLAY_ORDER.indexOf(b.class);
    if (ca !== cb) {
      return (ca === -1 ? DISPLAY_ORDER.length : ca) - (cb === -1 ? DISPLAY_ORDER.length : cb);
    }
    return a.id.localeCompare(b.id, "en", { numeric: true });
  });
}

// Unit ids are "<P|E>-<class>-<n>" (06) — the trailing number is the #n badge.
export function unitNumber(unit: Unit): string {
  return unit.id.split("-").pop() ?? "";
}

export function unitDisplayName(unit: Unit, meta: MetaResponse): string {
  return `${meta.classes[unit.class].label} #${unitNumber(unit)}`;
}

// Boundary-exact thresholds (05): green if > 2/3, amber if 1/3 ≤ f ≤ 2/3,
// red if < 1/3, hidden at full HP.
export function hpBarClass(hp: number, maxHp: number): string | null {
  if (hp >= maxHp) {
    return null;
  }
  const fraction = hp / maxHp;
  if (fraction > 2 / 3) {
    return "hp-green";
  }
  if (fraction >= 1 / 3) {
    return "hp-amber";
  }
  return "hp-red";
}
