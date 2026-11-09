# AI Integration — the Opponent Brain

> Everything LLM lives in `server/src/features/ai/`. The golden design rule, repeated from `00`: **the LLM decides, the engine executes.** The model computes ZERO damage, ZERO counters, ZERO deaths — it only returns movement/action intents, which `src/game/applyMoves` validates and executes. Any illegal intent bounces back to the model with a precise complaint; nothing ever quietly degrades.

## The client (`features/ai/llmClient.ts`)

One small module over Ollama's native chat API. Exactly these call sites exist in the whole codebase:

```ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface LlmClient {
  chat(args: {
    messages: ChatMessage[];     // caller builds: system + state + (on retries) prior failures
    temperature: number;
    schema: object;              // JSON Schema; Ollama `format` field guarantees valid JSON output
  }): Promise<unknown>;          // parsed JSON object (still un-validated — callers zod it)

  brief(opts: { user: string }): Promise<unknown>;              // single-shot board-design call (03): composes [{role:"user"}] internally, temperature = config.ai.briefTemperature (0.8 baseline)
  turn(opts: { messages: ChatMessage[]; temperature: number }): Promise<unknown>;   // AI-turn call (04)
}
```

- Real implementation: `POST {OLLAMA_URL}/api/chat` with `{ model: OLLAMA_MODEL, messages, stream: false, format: <schema>, options: { temperature } }` (`messages` passed straight through). Response: `body.message.content` — parse JSON. Non-2xx or unparsable ⇒ throws typed `LlmError`; caller counts it as a failed attempt, never as a crashed process.
- **Mock implementation** (`mockLlm.ts`, same interface): returns recorded/fixture JSON responses. Selection: the test runners (Vitest/Playwright configs) inject `LLM_MOCK=1` automatically — every automated run is mocked by definition; in day-to-day local dev, `LLM_MOCK=1` set once in the local `.env` selects it; production `.env` NEVER sets it. Two implementations, chosen explicitly; no plugin system.
- Conversations for the retry loop keep a `messages` array — see validation loop below. No streaming, no history, no embeddings, no sessions.

## Call #1 — board design brief

Specified entirely in `03-board-generation.md` (prompt, schema, retry, fallback). The client's `brief()` is its executor.

## Call #2 — the AI turn (the meat)

### System prompt (the persona)

Template (shown **rendered at baseline config** — literals like "15x15" or "0-14" are regenerated from `config.boardSize` at prompt-build time, never hand-edited; the one placeholder `«PERSONA BEHAVIOR TEXT»` is the personality's behavior text from below):

```
You are the commander of the BLACK army in a turn-based fantasy battle on a 15x15 grid.
Coordinates: x columns 0-14 (west→east), y rows 0-14 (north→south).
Your army spawns on the TOP rows (0-1); the player's army is on the BOTTOM rows (13-14).

PERSONA: «PERSONA BEHAVIOR TEXT»

RULES DIGEST:
- Each of your units once per turn: move up to its MOV tiles (4-neighbor path, cannot
  cross water except bridges, cannot finish on an occupied tile, cannot pass through
  enemy units), then ONE action.
- Actions: attack (only if Manhattan distance |dx|+|dy| from the final tile is within the
  unit's class RANGE — per-class values are in the STATS section — Manhattan = orthogonal
  steps walked, e.g. 2 tiles straight, or 1 forward + 1 sideways; diagonal offsets are 2,
  never 1), heal (healer only, adjacent ally below max HP), or wait.
- RANGE lists may skip distances: a unit attacks ONLY at the listed values (a range list
  written "[2]" means exactly 2 — distance 1 is illegal, distance 3 is illegal).
- Combat: damage = attacker's ATK − target's DEF (min 0). The defender counters
  automatically if your unit ends inside ITS range — killed units never counter.
  A dead unit is removed. Low-DEF units die in just a few hits — keep them protected.
- You win by destroying every enemy unit. Your units are the ones whose ids start with "E-".
- Units already eliminated are not in the state. Out-of-range attacks are illegal.

Above all else: be reliable about attack-range legality; your persona shapes
tactics, never legality.
```

Persona behavior texts (config personality `label` is the user-facing name; this text is prompt-internal)

- **aggressive**: "Hunt them without mercy. Close distance every turn. Concentrate all attacks on one wounded unit until it dies. Attack SUPPORTER units first — the backline the STATS section marks — they're fragile, they matter most, and they die easiest. When no supporter is reachable, hunt the most fragile reachable unit. Do not sit behind the river — you are the attacker."
- **defensive**: "Fight slowly and survive. Keep your healer 2+ tiles from the front, hold good bridge/forest lines, let them come to you and kill crossing units first. Retreat a wounded front unit backward, it's fine to give ground. Attack from your most favorable range whenever possible — ranged units fire from maximum range."
- **erratic**: "You are Brilliant but chaotic. Sometimes do something unexpected — split forces, leave a bait, change target for no tactical reason. Commit fully to whatever plan you pick; a chaotic attack is still an attack."

(Erratic's chaos largely comes from temperature 1.2 in config; the persona text adds the flavor the numbers can't.)

### User message — serialized state (exact format)

Compact over verbose — small models degrade as payload grows. Serializer lives in `features/ai/serialize.ts` and mirrors nothing else in the system (do not "improve" it to match DTO shapes — the compact token is deliberate). **Prompt-notation note:** the single-char tile glyphs inside the block are prompt-serialization encoding only — the engine, API, and DTOs always use the full tile words from `02` ("plain", "river", …); the serializer emits the chars, and no validator ever reads them:

```
BOARD (15x15): each row is one string of 15 chars.
  . plain | f forest | h hill | L lake | r rock | ~ river | B bridge
  rows top (y=0) to bottom (y=14), chars left (x=0) to right (x=14)

STATS: one line per class, GENERATED from config at prompt-build time.
  Format, exactly: <class>=hp<hp>/atk<atk>/def<def>/mov<mov>/rng<range>/role<role>
  - rng = the class's config `range` list rendered comma-joined; an EMPTY list renders
    as rng0 (that class cannot attack — e.g. the healer at baseline).
  - /heal<n> is appended only for classes with a config healAmount (baseline: /heal8).
  - role: attacker = melee frontliner; supporter = fragile high-value backline unit —
    the aggressive commander's priority target. Tag semantics are a game decision:
    "supporter" means kill-priority backline, not literal non-combatant (archers and
    mages still attack). Values come from config at build time.
  - one line, classes in config-key order, separated by " | ".
  Shape example, with FICTIONAL values on purpose (nothing here is config truth —
  the shipped prompt carries only the real numbers read from config.json at that moment):
  a-goon=hp40/atk3/def2/mov1/rng2,4/role-supporter | z-mini=hp9/atk6/def1/mov5/rng1/role-attacker

UNITS: BOTH armies, id=class x,y hp/maxHp
  your side = enemy (ids start with "E-"); the player's units (ids "P-…") are your legal targets
```

Followed by the literal serialized snapshot, i.e. for a fresh game:

```
BOARD:
...............   ← row 0 (y=0)
...............   ← row 1 (no spaces in actual output; the sample rows are split for readability)
...

UNITS:
E-sword-1=sword 5,1 20/20
E-sword-2=sword 6,1 20/20
E-axe-1=axe 7,1 25/25
E-axe-2=axe 8,1 25/25
E-spear-1=spear 9,1 18/18
E-spear-2=spear 5,0 18/18
E-archer-1=archer 6,0 16/16
E-archer-2=archer 8,0 16/16
E-mage-1=mage 10,0 15/15
E-healer-1=healer 11,0 18/18
P-sword-1=sword 4,13 20/20
… (player units occupy rows 13-14 within the 8×2 spawn block, columns 4-11; exact columns/gaps
 are seeded-random PER SIDE (the two armies are NOT mirror images of each other) —
 the sequence above is one example arrangement from one seed)
```

Followed by the ask:

```
Produce THIS TURN's orders for ALL your surviving units. Reply ONLY with JSON:
{"moves":[{"unitId":"E-…","path":[[x,y],…],"action":{"type":"attack","targetId":"P-…"} | {"type":"heal","targetId":"E-…"} | {"type":"wait"}}]}
- list `path` as the full walked route from the unit's current tile to its final tile;
  you may list unit orders in any order; omitting a unit means it does NOTHING this
  turn (stays un-acted — equivalent in effect to waiting, but the two are distinct
  paths: an explicit wait marks the unit acted).
- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.
```

### Response validation loop (bounded, exact)

```
attempt = 1..config.ai.moveRetries (3):
  1. llmClient.turn(messages, temperature = personality.temperature)
  2. zod (discriminated union): { moves: [{ unitId: string, path: [x,y][],
       action: {"type":"attack","targetId":string} | {"type":"heal","targetId":"E-…"} | {"type":"wait"} }] }
      — attack/heal REQUIRE targetId; wait must not expect one. Schema-fail →
       message to model: "Your reply was not valid JSON matching the schema.", retry.
  3. engine: applyMoves(state, moves, "enemy", engineCfg)   ← from 02-game-rules.md
     ok  → SUCCESS: persist new game row state (units positions/hps, status player_turn|lost,
            turnNumber+1, lastAiActions = the events list mapped to the AiAction DTO in 06),
            clear ai_last_error. Job ends.
     fail → message to model with the engine's exact rejection — the `02` catalogue
            string (e.g. "archer cannot attack a unit at 3 tiles"), prefixed with the
            unit ids for context, plus "Resubmit the FULL corrected move list." — retry.
after 3 failures: write ai_last_error = "<last error>", leave status=ai_turn,
  updated_at = now() (fresh sweep timer — a failed game waits a full minute before
  sweeping again, never hammers the model), turn_number unchanged. Recovery: the
  stale-recovery sweep (01) re-triggers the job when updated_at is older than
  config.ai.staleAfterSeconds (60 s), full fresh prompt, retries reset.
  NO fallback AI ever plays. The board is fully consistent at all times.
```

Notes locked this way:
- A partially valid move list is NOT applied at all — `applyMoves` is whole-bundle atomic (02). The model re-sends everything, corrected.
- `path` legality, occupancy, ranges, counters, deaths: all engine-computed. The model cannot desync state even in principle — it can only fail, and failures loop back into its own face.

## Prompt hygiene rules

- **Zero stat literals in prompts.** The only numbers the prompt system ever prints are config-rendered outputs — the STATS block, the movement/range counts, AND the board inside ("15x15" is rendered from `config.boardSize`, like everything else — see `03`'s brief; the same rule applies to this template's grid references). The digest and persona texts are written in *class-agnostic* terms ("low-DEF units", "most favorable range") so rebalancing config can never make a prompt lie. Class KEYS (`sword`, `axe`…) are stable identifiers, not tunables — they may appear in persona texts.
- Prompt strings live in code as named constants — `features/board/briefPrompt.ts` (03) and `features/ai/turnPrompt.ts` (04) — versioned like source, never generated on the fly from game strings besides the swapped values specified above; the STATS block is the sole config-derived part, emitted by one shared helper (`statsKernel(config)`), reused by both docs' prompt builders.
- Logs: on success record `{gameId, durationMs, promptChars, responseChars, attempt}` only. Full request/response pairs print only during local/dev runs; production never logs or DB-stores them.
- The serializer output for a mid-game state (some units dead, low HP) must still fit comfortably in the model's context window: worst case ≈ 15 board rows + 1 STATS line + 20 unit lines + prompt text < 4 KB ⇒ fine for 7–8B models.

## Tests

1. **Engine loop with mock LLM**: fixture state + fixture valid response ⇒ success path, events order, DB persistence shape.
2. **Retry loop**: fixture returns: (a) malformed JSON once then valid; (b) illegal move (out-of-range archer attack) once then valid — assert correction feedback message includes the engine error text.
3. **Exhaustion**: mock always-failing ⇒ after `moveRetries` (3): `ai_last_error` set, game still `ai_turn`, turn unchanged — then stale-recovery re-triggers (unit-tested with a fake clock? no — stub the timestamp compare; simple).
4. **Serializer**: golden fixture for a snapshot board+units string; verify stable under a config stat change (reads config, so no hardcoded 20/25).
5. **STATS kernel**: `statsKernel(config)` output matches the documented format; mutate the config (e.g. archer range `[2]` → `[2,3]`, or add a class) → the emitted STATS line changes accordingly, the digest/persona texts do NOT, and no test breaks.
6. **Role tag**: the STATS kernel exposes `role` per class; persona texts never name which classes are supporters — retag a class (e.g. mage → attacker) in config and the kernel + any tag logic change with it.
