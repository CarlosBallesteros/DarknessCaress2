import type { Unit, ClassKey, Side } from "../../game/types";
import type { GameEngineConfig } from "../../game/types";

function hashStringToUint32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FRONT_CLASSES: ClassKey[] = ["sword", "sword", "axe", "axe", "spear"];
const BACK_CLASSES: ClassKey[] = ["spear", "archer", "archer", "mage", "healer"];

export function spawnArmies(seed: string, config: GameEngineConfig): Unit[] {
  const size = config.boardSize;
  const rngBase = hashStringToUint32(`${seed}|spawn`);

  const allColumns = Array.from({ length: size }, (_, i) => i);

  function makeSide(side: Side): Unit[] {
    const frontRow = side === "player" ? size - 2 : 1;
    const backRow = side === "player" ? size - 1 : 0;
    const sideSalt = side === "player" ? 1 : 2;

    const rngFront = mulberry32(hashStringToUint32(`${rngBase}|${sideSalt}|front`));
    const rngBack = mulberry32(hashStringToUint32(`${rngBase}|${sideSalt}|back`));
    const rngFrontOrder = mulberry32(hashStringToUint32(`${rngBase}|${sideSalt}|frontOrder`));
    const rngBackOrder = mulberry32(hashStringToUint32(`${rngBase}|${sideSalt}|backOrder`));

    const frontCols = shuffle(rngFront, allColumns).slice(0, 5);
    const backCols = shuffle(rngBack, allColumns).slice(0, 5);
    const frontClassOrder = shuffle(rngFrontOrder, [...FRONT_CLASSES]);
    const backClassOrder = shuffle(rngBackOrder, [...BACK_CLASSES]);

    const sidePrefix = side === "player" ? "P" : "E";
    const classCounts: Record<ClassKey, number> = {
      sword: 0,
      axe: 0,
      spear: 0,
      archer: 0,
      mage: 0,
      healer: 0,
    };

    const units: Unit[] = [];
    const displayOrder: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];

    function pushUnit(cls: ClassKey, x: number, y: number): void {
      classCounts[cls] += 1;
      const n = classCounts[cls];
      const stats = config.classes[cls];
      units.push({
        id: `${sidePrefix}-${cls}-${n}`,
        side,
        class: cls,
        x,
        y,
        hp: stats.hp,
        maxHp: stats.hp,
        acted: false,
      });
    }

    const perClassQueues: Record<ClassKey, Array<{ x: number; y: number }>> = {
      sword: [],
      axe: [],
      spear: [],
      archer: [],
      mage: [],
      healer: [],
    };
    for (let i = 0; i < 5; i++)
      perClassQueues[frontClassOrder[i]].push({ x: frontCols[i], y: frontRow });
    for (let i = 0; i < 5; i++)
      perClassQueues[backClassOrder[i]].push({ x: backCols[i], y: backRow });

    for (const cls of displayOrder) {
      for (const pos of perClassQueues[cls]) {
        pushUnit(cls, pos.x, pos.y);
      }
    }

    return units;
  }

  return [...makeSide("player"), ...makeSide("enemy")];
}
