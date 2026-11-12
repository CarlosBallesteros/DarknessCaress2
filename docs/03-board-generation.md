# Board Generation — the AI Battlefield Designer

> Two-stage pipeline, in `server/src/features/board/` (pure helpers shared with `src/game/`):
> **Stage 1 — the LLM designs a *brief*** (a small layout plan as JSON). **Stage 2 — deterministic code materializes** it into a real `boardSize×boardSize` grid and validates the invariants. The LLM decides; the code guarantees.

Why split it: LLMs are bad at spatial reasoning (a raw grid from an LLM is unreliable) but excellent at *small structured decisions*. The brief is small enough to reason about; the materializer is deterministic and testable.

## Stage 1 — the design brief (the LLM call)

**Prompt template** (`features/board/briefPrompt.ts`, values in `« »` rendered from `config.boardSize` at prompt-build time; 8×8 baseline shown):

```
You are a battlefield designer for a small fantasy war game on a 8x8 grid.
Two armies spawn on the BOTTOM rows (6-7) and TOP rows (0-1).
Rows 0-1 and 6-7 of every column are RESERVED: no water, no obstacles there.

USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:
never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small
lake decorate the terrain. Respond ONLY with JSON matching exactly this shape
("river" may be null for a more rare open-field battlefield):

{
  "river":       <null or {"startRow": int 2-5, "endRow": int 2-5, "bends": int 1-3}>,
  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,
  "forestZones": <array, 1-3 items: {"centerX": int 2-5, "centerY": int 2-4, "radius": int 1-3}>,
  "hillZones":   <array, 0-2 items: {"centerX": int 2-5, "centerY": int 2-5, "radius": int 1-2}>,
  "lake":        <null or {"centerX": int 2-5, "centerY": int 3-4, "radius": int 1-2}>
}

Aim for a varied battlefield; a river crossing is the classic choice.
```

Temperature for this call: `config.ai.briefTemperature` (= 0.8 in baseline). The response is validated with zod against exactly this schema (extras rejected, ranges enforced). Example of a valid brief (8×8 baseline):

```json
{
  "river": {"startRow": 3, "endRow": 4, "bends": 2},
  "bridgeTiles": 1,
  "forestZones": [{"centerX": 2, "centerY": 2, "radius": 1}],
  "hillZones": [{"centerX": 5, "centerY": 3, "radius": 1}],
  "lake": {"centerX": 3, "centerY": 3, "radius": 1}
}
```

## Stage 2 — deterministic materializer (`features/board/materialize.ts`)

Inputs: the parsed brief + a **seed** (the game's uuid, hashed once — the SAME brief + seed always produces the SAME board, which makes board tests reproducible).

Algorithm, in order:

1. **Grid init**: every tile `plain`.
2. **River** (only when `brief.river` is non-null — skipped entirely otherwise):
   - Carve the river as a **4-connected simple path** (no loops, no branches) from `(0, brief.river.startRow)` rightward to `(size-1, brief.river.endRow)`: a seeded random walk that prefers **right**, occasionally sidesteps one tile up/down in short bounded vertical runs (a sidestep writes the intermediate vertical tiles so 4-connectivity always holds), and is steered segment-by-segment toward `endRow` — `bends` splits the columns into `bends + 1` segments. The simple-path property prevents loops/branches/spirals; the validator is the guarantee.
3. **Bridges** (river present only): bridge candidates are river tiles lying on a **horizontal run** (their immediate left AND right neighbors are also river tiles). Pick `bridgeTiles` positions among the candidates: if 2, as far apart as possible (first quarter / third quarter of width by column); if 1, middle; if a quarter has no horizontal-run candidate, take the nearest horizontal-run river tile to that quarter. Chosen river tiles become `bridge` (walkable). A bridge never sits on a vertical run.
4. **Lake**: paint a seeded circular blob (`(dx²+dy²) ≤ r²` mask) at the lake center, skipping any tile that is river or bridge or in reserved rows.
5. **Forest / hill zones**: same blob mask per zone, skipping river/bridge/lake/rock/reserved.
6. **A few rocks**: `rock` tiles sprinkled purely cosmetically (seeded, skip water/reserved).
7. **Reserved rows 0, 1, size-2, size-1**: all forced `plain` (overwriting everything above) — spawn safety is absolute.

## Invariants validator (`features/board/invariants.ts` — hard gates)

A materialized board is valid iff ALL hold; any failure ⇒ retry (policy below). Invariants 1–3 apply **only when the brief has a river** (a riverless board skips to invariant 4):

1. River exists as **one connected simple path** spanning left edge → right edge (each river tile has exactly 2 river/bridge neighbors except the two edge tiles, which have 1).
2. River never passes through reserved rows; never overlaps lake/rock.
3. Bridge count equals the brief's; every bridge lies on the river path.
4. **Crossability**: BFS from the player's spawn area to the enemy's spawn area using walkable tiles (`bridge` counts) has success — on a riverless board the field must still be open (the lake/rocks may not wall a spawn-side off).
5. Spawn slots: each army occupies **2 full rows of all board columns** (player bottom rows `size-2, size-1`; enemy top rows `0, 1`). Exactly 5 front-row units (2 swords, 2 axes, 1 spear) and 5 back-row units (remaining spear, 2 archers, mage, healer) are placed in those rows; the healer NEVER sits front. The seeded PRNG shuffles all columns per side and per row independently, so gaps vary per game while the same game reproduces the same arrangement. All spawn tiles must be walkable plain/terrain-safe and within the reserved spawn rows.
6. No water tile (`lake`/`river`) remains in reserved rows; spawn tiles are free of obstacles.

## Armies spawn layout (2 full-width rows, seeded scatter)

Each army occupies **2 full rows of all `boardSize` columns**: for the PLAYER, front = row `size-2` (facing the center) and back = row `size-1`; for the ENEMY, front = row `1` and back = row `0` — mirrored top-to-bottom. 10 units per side, with remaining columns left as gaps.

**Composition per row (fixed):**
- Front (5 units): the 2 swords, 2 axes and 1 spear.
- Back (5 units): the remaining spear, 2 archers, mage, healer.
- The **healer never sits front** (guaranteed by the row rule above).

**Scatter (seeded):** the seeded PRNG derives, per side and per row, a shuffled permutation of all columns; the first 5 columns receive that group's units, in shuffled order; the rest stay empty. Effects: gaps vary per game, the same game reproduces the same arrangement, sides scatter **independently** (no mirror-image symmetry), and all spawns stand on reserved, always-plain rows.

(Unit attributes on spawn: `hp = maxHp`, `acted = false`. Unit ids are `<P|E>-<class>-<n>` — side prefix P/E, `n` counted per class in display order; stable for the game's life.)

## Retry policy (bounded, exact)

1. Materialize with (seed + attempt counter) — validate invariants each time; first valid board wins. Budget from config (`config.ai.boardRetries`): **≤ `materializations` per brief, ≤ `briefs` total** (baseline: 3/3 → ≤ 9 attempts per `POST /api/games`).
2. All materializations of one brief fail (a bad brief): **regenerate the brief** via the LLM prompt above (temperature unchanged), then retry its seeds.
3. All materializations of all briefs fail (LLM degraded/offline): **fallback board** — a committed constant, `FALLBACK_BRIEF`, materialized by the same seeded pipeline with the **same fixed seed** (fully deterministic). Not a *gameplay* heuristic — a deterministic backup brief through the normal pipeline. Record in the game row (`used_fallback = true`) that the fallback fired (for stats/debug).

Baseline fallback brief (8×8): riverless open field with small forest/hill/lake decoration, materialized with fixed seed `20261112`.
4. Only if even the fallback fails to validate does the job fail fatally (a code bug) — it writes `ai_last_error`, leaves `generating_board`, and the stale sweep retries (docs/06 endpoint 10 / docs/01 runtime model).

## Engine tests (`features/board/…test.ts`)

1. **Property test with fixed seeds** (≥ 40 seeds): materialize → assert all invariants → "the river always reaches the opposite edge" is a fact, not a hope.
2. **Seeded snapshot/determinism**: same brief + fixed seed ⇒ identical board twice.
3. **Fallback template** validates invariants by construction.
4. **Mock-Llm brief**: the mock client (see `04-ai-integration.md`) returns a fixed brief; the full creation → board → spawn flow runs without a live model.
5. **Spawn scatter**: same seed ⇒ identical arrangement twice; across ≥ 40 seeds arrangements vary (gaps included) and the healer is ALWAYS in the back row.
6. **Riverless brief**: `river: null` ⇒ zero water tiles except the lake; crossability holds without bridges.
