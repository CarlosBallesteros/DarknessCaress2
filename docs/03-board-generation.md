# Board Generation — the AI Battlefield Designer

> Two-stage pipeline, in `server/src/features/board/` (pure helpers shared with `src/game/`):
> **Stage 1 — the LLM designs a *brief*** (a small layout plan as JSON). **Stage 2 — deterministic code materializes** it into a real 15×15 grid and validates the invariants. The LLM decides; the code guarantees.

Why split it: LLMs are bad at spatial reasoning (a raw 15×15 grid from an LLM is garbage — broken rivers, unreachable zones) but excellent at *small structured decisions*. The brief is small enough to reason about; the materializer is deterministic and testable.

## Stage 1 — the design brief (the LLM call)

**Prompt template** (`features/board/briefPrompt.ts`, text verbatim, values in `« »` swapped in):

```
You are a battlefield designer for a small fantasy war game on a 15x15 grid.
Two armies spawn on the left side (columns 0-1) and right side (columns 13-14).
Columns 0-1 and 13-14 of every row are RESERVED: no water, no obstacles there.

A river runs from the TOP edge to the BOTTOM edge. It must curve: it may not be
straight. 1 or 2 bridges cross it. Hills, forests and a small lake decorate the
terrain. Respond ONLY with JSON matching exactly this shape:

{
  "startColumn": <integer 2-12, where the river meets the top edge>,
  "endColumn":   <integer 2-12, where the river meets the bottom edge>,
  "bends":       <integer 1-3, how many left/right turns the river makes>,
  "bridgeTiles": <integer 1 or 2>,
  "forestZones": <array, 1-3 items: {"centerX": int 4-10, "centerY": int 2-12, "radius": int 1-3}>,
  "hillZones":   <array, 0-2 items: {"centerX": int 4-10, "centerY": int 2-12, "radius": int 1-2}>,
  "lake":        <null or {"centerX": int 4-10, "centerY": int 2-12, "radius": int 1-2}>
}

Aim for a varied battlefield that gives both armies an interesting crossing problem.
```

Temperature for this call: `0.8` (variety is the point). The response is validated with zod against exactly this schema (extras rejected, ranges enforced). Example of a valid brief:

```json
{
  "startColumn": 7, "endColumn": 6, "bends": 2, "bridgeTiles": 2,
  "forestZones": [{"centerX": 5, "centerY": 4, "radius": 2}, {"centerX": 9, "centerY": 10, "radius": 2}],
  "hillZones": [{"centerX": 10, "centerY": 3, "radius": 1}],
  "lake": {"centerX": 7, "centerY": 8, "radius": 1}
}
```

## Stage 2 — deterministic materializer (`features/board/materialize.ts`)

Inputs: the parsed brief + a **seed** (the game's uuid, hashed once — the SAME brief + seed always produces the SAME board, which makes board tests reproducible).

Algorithm, in order:

1. **Grid init**: every tile `plain`.
2. **River** (the important part):
   - Carve the river as a **4-connected simple path** (no loops, no branches) from `(startColumn, 0)` down to `(endColumn, 14)`: a seeded random walk that prefers **down**, occasionally sidesteps one tile left/right in short bounded horizontal runs (a sidestep writes the intermediate horizontal tiles so 4-connectivity always holds), and is steered segment-by-segment toward `endColumn` — `bends` splits the 14 rows into `bends + 1` segments, each segment carrying a seeded target column. The simple-path property alone structurally prevents spirals, loops and floods; the walk always terminates because a downward move is always available to water.
3. **Bridges**: pick `bridgeTiles` positions from the river tiles: if 2, as far apart as possible (first quarter / third quarter of depth by row); if 1, middle. Chosen river tiles become `bridge` (walkable).
4. **Lake**: paint a seeded circular blob (the classic `(dx²+dy²) ≤ r²` mask) at the lake center, skipping any tile that is river or bridge or in reserved columns.
5. **Forest / hill zones**: same blob mask per zone, skipping river/bridge/lake/rock/reserved.
6. **A few rocks**: `rock` tiles sprinkled purely cosmetically (seeded, ~8–12 of them, skip water/reserved).
7. **Reserved columns 0, 1, 13, 14**: all forced `plain` (overwriting everything above) — spawn safety is absolute.

## Invariants validator (`features/board/invariants.ts` — hard gates)

A materialized board is valid iff ALL hold; any failure ⇒ retry (policy below):

1. River exists as **one connected simple path** spanning top edge → bottom edge (each river tile has exactly 2 river/bridge neighbors except the two edge tiles, which have 1).
2. River never passes through reserved columns; never overlaps lake/rock.
3. Bridge count equals the brief's; every bridge lies on the river path.
4. **Crossability**: BFS from any player spawn tile to any enemy spawn tile using walkable tiles (`bridge` counts) has success — i.e., at least one bridge connects both banks in practice. (Once invariant 1+3 hold with ≥1 bridge this should always be true — the check exists so a future bug can't fake it.)
5. No water tile (`lake`/`river`) remains in reserved columns; spawn tiles are empty of obstacles.

## Armies spawn layout (standard, both sides mirror)

| Row | Player (col 0/1) | Enemy (col 13/14) |
|---|---|---|
| 4 | swordsman | swordsman |
| 5 | swordsman | swordsman |
| 6 | axeman | axeman |
| 7 | axeman | axeman |
| 8 | spearman | spearman |
| 9 | spearman | spearman |
| 10 | archer | archer |
| 11 | archer | archer |
| 12 (col 0/1 → 13/14) | mage | mage |
| 13 | healer | healer |

(Row indexes are from the top: player col 0 is west; enemy mirrored east.) Spawn overrides units' `hp = maxHp`, `acted = false`.

## Retry policy (bounded, exact)

1. Materialize with seed(seed + attempt counter), attempt 1…3 — validate invariants. First valid board wins.
2. All 3 attempts fail with the SAME brief (a bad brief, e.g. bridges requested outside the river): **regenerate the brief** via the LLM prompt above (temperature unchanged), then retry its 3 seeds. Up to 3 briefs total.
3. All briefs fail (LLM degraded/offline): **fallback board** — a committed hardcoded template (gentle S-curve river with 2 bridges near columns 4 and 10, two forests, one line of hills), materialized by the same code as constants. Not a *gameplay* heuristic — a deterministic backup layout. Record in the game row that the fallback fired (for stats/debug).
4. Returns `503` to `POST /api/games` only if even the fallback fails to validate (means a code bug, not an AI hiccup).

## Engine tests (`features/board/…test.ts`)

1. **Property test with fixed seeds** ( ≥ 40 seeds): materialize → assert all invariants → this is the suite that makes "the river always reaches the bottom" a fact, not a hope.
2. **Seeded snapshot test**: brief + fixed seed ⇒ exact same board (regression on the deterministic claim).
3. **Determinism**: two runs of the same brief+seed produce identical grids.
4. **Fallback template** validates invariants by construction.
5. **Mock-Llm brief**: the mock client (see `04-ai-integration.md` → mock) returns a fixed brief; the full creation → board → spawn flow runs without a live model.
