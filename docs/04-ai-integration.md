# AI Integration — the Opponent Brain

> `server/src/features/ai/` owns opponent decisions. **The engine executes.** Damage, counters, deaths, path legality, and state transitions are always computed by `src/game/` — never by any decision layer. Board design remains LLM-driven (Call #1); **move decisions are server-side tactical policies** (Call #2), not LLM calls.

## Board design — LLM (Call #1, unchanged)

The battlefield designer is the one remaining LLM "curiosity": a small structured call generates the layout brief for each new board. Specified entirely in `03-board-generation.md` (prompt, schema, retry, fallback). The client (`features/ai/llmClient.ts`) executes `brief()` only.

### The client (`features/ai/llmClient.ts`)

One small module over Ollama's native chat API, used for **board briefs only**:

```ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface LlmClient {
  chat(args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object;              // JSON Schema; Ollama `format` field
  }): Promise<unknown>;          // parsed JSON (callers zod it)

  brief(opts: { user: string }): Promise<unknown>; // board-design call (03)
}
```

- Real implementation: `POST {OLLAMA_URL}/api/chat` with `{ model: OLLAMA_MODEL, messages, stream: false, format: <schema>, options: { temperature, num_predict: 2048 } }`. Response: `body.message.content` parsed as JSON. Non-2xx or unparsable ⇒ typed `LlmError` (callers count as a failed attempt, never a crashed process).
- **Mock implementation** (`mockLlm.ts`, same interface): returns committed fixture JSON. `LLM_MOCK=1` selects it (tests inject automatically; local dev may set in `.env`; production never). `brief()` serves `__fixtures__/brief.valid.json`.
- No conversations, no streaming, no history for briefs beyond the single-shot prompt.

## Move decisions — server-side policies (Call #2)

Enemy moves are decided by **deterministic menu-choice policies** implemented in `features/ai/policy.ts` (and invoked by `features/ai/aiTurn.ts`). There is no LLM in the move loop, no prompt/schema/retry cycle, and no model-dependent latency.

### Inputs

- The authoritative game snapshot: `board`, `units`, acting side = `"enemy"`.
- `difficulty` = the game's persona id (`"aggressive" | "defensive" | "erratic"`), stored on the game row (validated against `config.personalities` at creation).
- Engine/config: `engineConfig` / `config.classes` for reach, ranges, roles, heal amounts.

### Legal option generation (engine-owned)

For each surviving enemy unit (processed in stable id order), the policy derives options from the same engine primitives the UI/preview use — **never grid math in the policy**:

- `previewMove(board, units, unit, engineConfig)` → `moveTiles`, `attackTiles`, `healTiles`.
- **Attack pairs:** for each player unit attackable from any reachable tile, the valid `to` destinations are reachable tiles from which that target is within the class range list (Manhattan). Pairs are `(targetId, to)`; a unit with attack pairs treats those `to` tiles as its action-relevant destinations.
- **Heal pairs (healer, `healAmount` present):** for each wounded same-side ally healable this turn, valid `to` tiles are reachable tiles adjacent (Manhattan 1) to that ally. Pairs are `(allyId, to)`.
- **Move-only:** units with no attack/heal pairs choose from reachable `moveTiles` (advancing/waiting). Omitting `to` / staying on the unit's own tile is always legal (wait-in-place).

Options are recomputed against the **current evolving snapshot** as orders are assigned (see claiming below) so choices respect tiles already claimed by earlier orders in the same bundle.

### Destination-only orders and expansion

Policies emit **destination-only** orders (the AI's internal format):

```ts
{ unitId: string, to?: [x, y], action: { type: "attack", targetId: string } | { type: "heal", targetId: string } | { type: "wait" } }
```

`to` omitted -> stay in place. For each order, `aiTurn` expands `to` to the full walked path via `pathTo(board, units, unit, to, engineConfig)` (`src/game/reach.ts`, docs/02), producing a standard `Move` (same shape as player moves). The **player contract (endpoint 13) remains unchanged** (players always submit full paths). Expansion and execution go through the same engine machinery as player moves: path/landing legality, counters, deaths, and all other rules are enforced by `src/game/`.

### Persona policies (menu-choice)

Each persona is a choice policy over the same engine-generated options. Behavior is code (not prompt text); `config.personalities` carries label/temperature metadata but **temperature does not affect moves**.

- **Aggressive (`aggressive`)**
  - If the unit has attack pairs: attack a priority target - prefer **supporter**-role player units (config `role`), then lowest `hp`, then smallest Manhattan distance from the unit; choose the paired `to` that minimizes distance to that target (tie-break stable/deterministic). Units with no attack pairs advance: pick a reachable/move `to` that minimizes distance to the nearest surviving player unit.
  - The healer prefers heal pairs for the most wounded eligible ally; if none, stays safe/back (does not rush the front) and does not attack.

- **Defensive (`defensive`)**
  - Prefer holding ground behind own lines: choose `to` that maximizes distance from the nearest player unit while staying on/near the spawn side (top rows); avoid advancing into the open when no safe advantage exists.
  - Attack only when a paired attack option is available without needlessly advancing forward into danger (prefer attacking from a `to` no closer to the nearest player unit than the current position, when such a pair exists); otherwise favor a safe move/wait. Protect the healer (keep it back, heal when a pair exists).

- **Erratic (`erratic`)**
  - Pick uniformly at random among each unit's legal options (any valid attack pair, heal pair, or move/wait). Randomness is the persona's "chaos"; legality is never compromised. Selection is per-decision from the currently-legal set.

*(Policies are specified at this intent level; tie-breakers must be deterministic for aggressive/defensive given the same state/order context and claim state. Erratic is intentionally stochastic but always legal.)*

### Sequential simulation, claiming, and bundle ordering

Enemy units act in a stable unit order (by id). For each unit, `aiTurn` computes a legal destination/order against the **current simulated state**, expands it to a path, and applies that single move via the engine before choosing for the next unit. This means combat outcomes (damage, counters, deaths/removals, HP changes) from earlier actions are reflected in later decisions and later legality checks, preventing illegal targets (e.g. attacking a unit killed earlier in the same turn).

The policy tracks **claimed destination tiles** for enemy units that have already completed an action and remain alive on their destination, so later choices in the same turn do not select a tile already occupied/claimed by a prior enemy action. If a preferred option becomes invalid in the current context, the policy falls back to the next-best legal option (or wait-in-place). If a resolved move cannot be applied, it is degraded to a legal wait-in-place for that unit.

### Execution (`runAiTurn`)

```
1. Load row; require status === "ai_turn" (else return - idempotent/guarded).
2. In stable enemy id order, for each living enemy unit against the current simulated state:
   - compute a destination-only order via policy,
   - expand to a full path with pathTo (fallback: wait-in-place),
   - apply the single move via applyMoves("enemy", ...) to obtain the next state/events
     (on unexpected apply failure, degrade to wait-in-place and apply),
   - accumulate the move/events and continue with the resulting state.
3. Derive victory from the final state (enemy wipes player army -> "lost", else "player_turn").
4. On success: persist conditionally (UPDATE WHERE status='ai_turn') - if forfeited mid-job, discard.
   status, units/board state, turnNumber+1, lastAiActions, ai_last_error cleared.
5. On unexpected failure: write ai_last_error, leave ai_turn, turn_number unchanged, updated_at = now()
   (fresh sweep timer). The stale sweep may re-trigger.
```

### Stale recovery

AI turn jobs remain fire-and-forget with the same ACTIVE-JOB set guard and stale-recovery sweep as board jobs (`01`): a job may be re-triggered on GET side effects or by the server-side interval sweep when `updated_at` is older than `config.ai.staleAfterSeconds`. Because policies are pure over the persisted snapshot, re-execution is safe and produces a consistent result.

### Board brief logging and hygiene

- Brief calls log `{call:"brief", durationMs, promptChars, responseChars}` only; no request/response bodies in production (unchanged from prior behavior).
- Turn decisions are local computation; no model I/O to log for moves.

### Tests

1. **Policy legality:** for representative snapshots and each difficulty, every produced order expands and the bundle applies via `applyMoves` without error; no unit acts twice, no claimed-tile conflicts, no attacks/heals outside engine-legal pairs.
2. **Persona intent:** aggressive advances/targets per policy (prefers supporters/wounded), defensive holds ground/avoids reckless advance, erratic chooses only from legal options across varied seeds/snapshots.
3. **Integration (`runAiTurn`):** valid snapshot ⇒ status flips `player_turn` (or `lost` when player wiped), `turn_number` increments, `lastAiActions` populated, `ai_last_error` cleared. Conditional persist: forfeited-during-run discards results. Unexpected failure path leaves `ai_turn` with `ai_last_error` and unchanged turn.
4. **Board brief:** `brief()` mock/real behavior and schema validation unchanged (`03`).
5. **Serializer / STATS kernel:** snapshot serialization and `statsKernel` remain correct/config-driven (shared utilities; not LLM-turn-specific).
