# Board Generation — the AI Battlefield Designer

> Two-stage pipeline, in `server/src/features/board/` (pure helpers shared with `src/game/`):
> **Stage 1 — the LLM designs a *brief*** (a small layout plan as JSON). **Stage 2 — deterministic code materializes** it into a real 15×15 grid and validates the invariants. The LLM decides; the code guarantees.

Why split it: LLMs are bad at spatial reasoning (a raw 15×15 grid from an LLM is garbage — broken rivers, unreachable zones) but excellent at *small structured decisions*. The brief is small enough to reason about; the materializer is deterministic and testable.

## Stage 1 — the design brief (the LLM call)

**Prompt template** (`features/board/briefPrompt.ts`, text verbatim, values in `« »` swapped in — including the grid size, which comes from `config.boardSize`, rendered as "15x15" at baseline):

```
You are a battlefield designer for a small fantasy war game on a 15x15 grid.
Two armies spawn on the BOTTOM rows (13-14) and TOP rows (0-1).
Rows 0-1 and 13-14 of every column are RESERVED: no water, no obstacles there.

USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:
never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small
lake decorate the terrain. Respond ONLY with JSON matching exactly this shape
("river" may be null for a more rare open-field battlefield):

{
  "river":       <null or {"startRow": int 2-12, "endRow": int 2-12, "bends": int 1-3}>,
  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,
  "forestZones": <array, 1-3 items: {"centerX": int 2-12, "centerY": int 2-11, "radius": int 1-3}>,
  "hillZones":   <array, 0-2 items: {"centerX": int 2-12, "centerY": int 2-12, "radius": int 1-2}>,
  "lake":        <null or {"centerX": int 2-12, "centerY": int 3-11, "radius": int 1-2}>
}

Aim for a varied battlefield; a river crossing is the classic choice.
```

Temperature for this call: `config.ai.briefTemperature` (= 0.8 in baseline). The response is validated with zod against exactly this schema (extras rejected, ranges enforced). Example of a valid brief:

```json
{
  "river": {"startRow": 7, "endRow": 6, "bends": 2},
  "bridgeTiles": 2,
  "forestZones": [{"centerX": 5, "centerY": 4, "radius": 2}, {"centerX": 9, "centerY": 10, "radius": 2}],
  "hillZones": [{"centerX": 10, "centerY": 3, "radius": 1}],
  "lake": {"centerX": 7, "centerY": 7, "radius": 1}
}
```

## Stage 2 — deterministic materializer (`features/board/materialize.ts`)

Inputs: the parsed brief + a **seed** (the game's uuid, hashed once — the SAME brief + seed always produces the SAME board, which makes board tests reproducible).

Algorithm, in order:

1. **Grid init**: every tile `plain`.
2. **River** (only when `brief.river` is non-null — skipped entirely otherwise):
   - Carve the river as a **4-connected simple path** (no loops, no branches) from `(0, brief.river.startRow)` rightward to `(14, brief.river.endRow)`: a seeded random walk that prefers **right**, occasionally sidesteps one tile up/down in short bounded vertical runs (a sidestep writes the intermediate vertical tiles so 4-connectivity always holds), and is steered segment-by-segment toward `endRow` — `bends` splits the 14 columns into `bends + 1` segments, each segment carrying a seeded target row. The simple-path property prevents loops/branches/spirals, and the neighbor-count invariant (below) additionally rejects self-touching tiles — the validator, not the walk, is the guarantee; the walk always terminates because a rightward move is always available to water.
3. **Bridges** (river present only): pick `bridgeTiles` positions from the river tiles: if 2, as far apart as possible (first quarter / third quarter of width by column); if 1, middle. Chosen river tiles become `bridge` (walkable).
4. **Lake**: paint a seeded circular blob (the classic `(dx²+dy²) ≤ r²` mask) at the lake center, skipping any tile that is river or bridge or in reserved rows.
5. **Forest / hill zones**: same blob mask per zone, skipping river/bridge/lake/rock/reserved.
6. **A few rocks**: `rock` tiles sprinkled purely cosmetically (seeded, ~8–12 of them, skip water/reserved).
7. **Reserved rows 0, 1, 13, 14**: all forced `plain` (overwriting everything above) — spawn safety is absolute.

## Invariants validator (`features/board/invariants.ts` — hard gates)

A materialized board is valid iff ALL hold; any failure ⇒ retry (policy below). Invariants 1–3 apply **only when the brief has a river** (a riverless board skips to invariant 4):

1. River exists as **one connected simple path** spanning left edge → right edge (each river tile has exactly 2 river/bridge neighbors except the two edge tiles, which have 1).
2. River never passes through reserved rows; never overlaps lake/rock.
3. Bridge count equals the brief's; every bridge lies on the river path.
4. **Crossability**: BFS from any player spawn tile to any enemy spawn tile using walkable tiles (`bridge` counts) has success — on a riverless board the field must still be open (the lake/rocks may not wall a spawn-side off). The check exists so a future bug can't fake it.
5. Spawn slots: within each army's 8×2 block (columns 4–11), exactly 5 front-row units (2 swords, 2 axes, 1 spear) and 5 back-row units (remaining spear, 2 archers, mage, healer) are placed — healer NEVER front; 3 empty gaps per row; both sides' arrangements are seeded (same game ⇒ same arrangement).
6. No water tile (`lake`/`river`) remains in reserved rows; spawn tiles are empty of obstacles.

## Armies spawn layout (8×2 block with gaps, seeded scatter)

Each army occupies an **8×2 block, columns 4–11**, two rows: for the PLAYER, front = row 13 (facing the river/center) and back = row 14; for the ENEMY, front = row 1 (facing the river/center) and back = row 0 — the enemy side mirrors top-to-bottom, front row nearer the middle. 16 slots, **10 units, 6 gaps** — the blocks are wider than the armies so openings are already irregular before units move.

**Composition per row (fixed):**
- Front (5 units among 8 slots): the 2 swords, 2 axes and 1 spear.
- Back (5 units among 8 slots): the remaining spear, 2 archers, mage, healer.
- The **healer never sits front** (guaranteed by the row rule above).

**Scatter (seeded):** the seeded PRNG (same family as materialization) derives, per side and per row, a shuffled permutation of the 8 columns; the first 5 columns receive that group's units, in the shuffled order; the other 3 columns stay empty. Effects guaranteed by construction: gaps vary per game (different games likely look different), the same game always reproduces the exact same arrangement, sides scatter **independently** (no mirror-image symmetry), and no spawn ever lands outside the 8×2 block standing on reserved, always-plain rows.

(Unit attributes on spawn: `hp = maxHp`, `acted = false`. Unit ids are `<P|E>-<class>-<n>` — side prefix P for player / E for enemy, `n` counted per class in display order; assigned at spawn and stable for the game's life. Readable ids are deliberate: they are what the LLM sees and what validation errors quote.)

## Retry policy (bounded, exact)

1. Materialize with (seed + attempt counter) — validate invariants each time; first valid board wins. Budget from config (`config.ai.boardRetries`): **≤ `materializations` per brief, ≤ `briefs` total** (baseline: 3/3 → ≤ 9 attempts per `POST /api/games`).
2. All materializations of one brief fail (a bad brief, e.g. bridges requested outside the river): **regenerate the brief** via the LLM prompt above (temperature unchanged), then retry its seeds — that's the next brief of the budget above.
3. All briefs fail (LLM degraded/offline): **fallback board** — a committed hardcoded template (gentle S-curve river with 2 bridges near rows 4 and 10, two forests, one line of hills), materialized by the same code as constants. Not a *gameplay* heuristic — a deterministic backup layout. Record in the game row that the fallback fired (for stats/debug).
4. Returns `503` to `POST /api/games` only if even the fallback fails to validate (means a code bug, not an AI hiccup).

## Engine tests (`features/board/…test.ts`)

1. **Property test with fixed seeds** ( ≥ 40 seeds): materialize → assert all invariants → this is the suite that makes "the river always reaches the opposite edge" a fact, not a hope.
2. **Seeded snapshot test**: brief + fixed seed ⇒ exact same board (regression on the deterministic claim).
3. **Determinism**: two runs of the same brief+seed produce identical grids.
4. **Fallback template** validates invariants by construction.
5. **Mock-Llm brief**: the mock client (see `04-ai-integration.md` → mock) returns a fixed brief; the full creation → board → spawn flow runs without a live model.
6. **Spawn scatter**: same seed ⇒ identical arrangement twice; across ≥ 40 seeds the column sets/orders vary (gaps included) and the healer is ALWAYS in the back row.
7. **Riverless brief**: `river: null` ⇒ zero water tiles except the lake; crossability holds without bridges.
