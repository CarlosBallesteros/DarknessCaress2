# AI Integration — the Opponent Brain

> Everything LLM lives in `server/src/features/ai/`. The golden design rule, repeated from `00`: **the LLM decides, the engine executes.** The model computes ZERO damage, ZERO counters, ZERO deaths — it only returns movement/action intents, which `src/game/applyMoves` validates and executes. Any illegal intent bounces back to the model with a precise complaint; nothing ever quietly degrades.

## The client (`features/ai/llmClient.ts`)

One small module over Ollama's native chat API. Exactly these call sites exist in the whole codebase:

```ts
export interface LlmClient {
  chat(args: {
    system: string;
    user: string;
    temperature: number;
    schema: object;              // JSON Schema; Ollama `format` field guarantees valid JSON output
  }): Promise<unknown>;          // parsed JSON object (still un-validated — callers zod it)

  brief(opts: { user: string }): Promise<unknown>;   // board-design call (03), temperature 0.8
  turn(opts: { user: string; temperature: number }): Promise<unknown>;
}
```

- Real implementation: `POST {OLLAMA_URL}/api/chat` with `{ model: OLLAMA_MODEL, messages: [{role:"system"},{role:"user"}], stream: false, format: <schema>, options: { temperature } }`. Response: `body.message.content` — parse JSON. Non-2xx or unparsable ⇒ throws typed `LlmError`; caller counts it as a failed attempt, never as a crashed process.
- **Mock implementation** (`mockLlm.ts`, same interface): returns recorded/fixture JSON responses. Selected by `LLM_MOCK=1` env in tests/E2E. Two implementations, chosen explicitly; no plugin system.
- Conversations for the retry loop keep a `messages` array — see validation loop below. No streaming, no history, no embeddings, no sessions.

## Call #1 — board design brief

Specified entirely in `03-board-generation.md` (prompt, schema, retry, fallback). The client's `brief()` is its executor.

## Call #2 — the AI turn (the meat)

### System prompt (the persona)

Template (verbatim; `«PERSONA»` is the personality's behavior text from below, `«TACTICS»` = rules digest):

```
You are the commander of the BLACK army in a turn-based fantasy battle on a 15x15 grid.
Coordinates: x columns 0-14 (west→east), y rows 0-14 (north→south).

PERSONA: «PERSONA BEHAVIOR TEXT»

RULES DIGEST:
- Each of your units once per turn: move up to its MOV tiles (4-neighbor path, cannot
  cross water except bridges, cannot finish on an occupied tile, cannot pass through
  enemy units), then ONE action.
- Actions: attack (only if final tile's Manhattan distance to target is within the
  unit's RANGE list), heal (healer only, adjacent ally below max HP), or wait.
- Range kernel: sword/axe/spear hit adjacent-only; archer attacks ONLY at distance
  2 (never 1); mage at distance 1, 2 or 3.
- Combat: damage = attacker's ATK − target's DEF (min 0). The defender counters
  automatically if your unit ends inside ITS range — killed units never counter.
  A dead unit is removed. Archers die fast (DEF 2) — so do mages (DEF 1).
- You win by destroying every enemy unit. Yours are the units with enemy ids.
- Units already eliminated are not in the state. Out-of-range attacks are illegal.

Above all else: be reliable about attack-range legality; your persona shapes
tactics, never legality.
```

Persona behavior texts (config personality `label` is the user-facing name; this text is prompt-internal)

- **aggressive**: "Hunt them without mercy. Close distance every turn. Concentrate all attacks on one wounded unit until it dies, prefer killing archers and mages first. Do not sit behind the river — you are the attacker."
- **defensive**: "Fight slowly and survive. Keep your healer 2+ tiles from the front, hold good bridge/forest lines, let them come to you and kill crossing units first. Retreat a wounded front unit backward, it's fine to give ground. Attack only from favorable range (mages at 3, archers at 2) whenever possible."
- **erratic**: "You are Brilliant but chaotic. Sometimes do something unexpected — split forces, leave a bait, change target for no tactical reason. Commit fully to whatever plan you pick; a chaotic attack is still an attack."

(Erratic's chaos largely comes from temperature 1.2 in config; the persona text adds the flavor the numbers can't.)

### User message — serialized state (exact format)

Compact over verbose — small models degrade as payload grows. Serializer lives in `features/ai/serialize.ts` and mirrors nothing else in the system (do not "improve" it to match DTO shapes — the compact token is deliberate):

```
BOARD (15x15): each row is one string of 15 chars.
  . plain | f forest | h hill | L lake | r rock | ~ river | B bridge
  rows top (y=0) to bottom (y=14), chars left (x=0) to right (x=14)

UNITS: id=class x,y hp/maxHp side
  your side = enemy, ids start with "E-"
  threat classes at a glance: sword atk7 def5 | axe atk10 def3 | spear atk6 def3
  archer atk6 def2 rng2 | mage atk8 def1 rng1-3 | healer heals-8 def2 (no attack)
```

Followed by the literal serialized snapshot, i.e. for a fresh game:

```
BOARD:
...............   ← row 0 (y=0)
...............   ← row 1 (no spaces in actual output; the sample rows are split for readability)
...

UNITS:
E-sword-1=sword 13,4 20/20
E-sword-2=sword 14,4 20/20
E-axe-1=axe 13,6 25/25
E-axe-2=axe 14,6 25/25
E-spear-1=spear 13,8 18/18
E-spear-2=spear 14,8 18/18
E-archer-1=archer 13,10 16/16
E-archer-2=archer 14,10 16/16
E-mage-1=mage 13,12 15/15
E-healer-1=healer 14,13 18/18
P-sword-1=sword 0,4 20/20
… (player units per the config composition)
```

Followed by the ask:

```
Produce THIS TURN's orders for ALL your surviving units. Reply ONLY with JSON:
{"moves":[{"unitId":"E-…","path":[[x,y],…],"action":{"type":"attack","targetId":"P-…"} | {"type":"heal","targetId":"E-…"} | {"type":"wait"}}]}
- list `path` as the landing route's tile sequence from the unit's current tile to its final tile;
  you may list unit orders in any order; omit any unit to make it wait.
- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.
```

### Response validation loop (bounded, exact)

```
attempt = 1..config.ai.moveRetries (3):
  1. llmClient.turn(messages, temperature = personality.temperature)
  2. zod: { moves: [{ unitId: string, path: [x,y][], action: {type:"attack"|"heal"|"wait", targetId?: string} }] }
     fail → message to model: "Your reply was not valid JSON matching the schema.", retry.
  3. engine: applyMoves(state, moves, "enemy", engineCfg)   ← from 02-game-rules.md
     ok  → SUCCESS: persist new game row state (units positions/hps, status player_turn|lost,
            turnNumber+1, lastAiActions = the events list mapped to the AiAction DTO in 06),
            clear ai_last_error. Job ends.
     fail → message to model with the engine's exact rejection (e.g.
            "E-archer-2 cannot attack P-spear-1 at distance 3 — archer range is exactly 2.
             Resubmit the FULL corrected move list."), retry.
after 3 failures: write ai_last_error = "<last error>", leave status=ai_turn,
  turn_number unchanged. Recovery: the stale-recovery sweep (01) re-triggers the job
  after config.ai.staleAfterSeconds (60 s), full fresh prompt, retries reset.
  NO fallback AI ever plays. The board is fully consistent at all times.
```

Notes locked this way:
- A partially valid move list is NOT applied at all — `applyMoves` is whole-bundle atomic (02). The model re-sends everything, corrected.
- `path` legality, occupancy, ranges, counters, deaths: all engine-computed. The model cannot desync state even in principle — it can only fail, and failures loop back into its own face.

## Prompt hygiene rules

- Prompt strings live in code as named constants (`briefPrompt.ts`, `turnPrompt.ts`) — versioned like source, never generated on the fly from game strings besides swapped values specified above.
- Logs: on success record `{gameId, durationMs, promptChars, responseChars, attempt}` only. Full request/response pairs always locally in dev; NEVER in the production database via the info level.
- The serializer output for a mid-game state (some units dead, low HP) must still fit comfortably in the model's context window: worst case ≈ 15 rows + 20 unit lines + prompt text < 4 KB ⇒ fine for 7–8B models.

## Tests

1. **Engine loop with mock LLM**: fixture state + fixture valid response ⇒ success path, events order, DB persistence shape.
2. **Retry loop**: fixture returns: (a) malformed JSON once then valid; (b) illegal move (out-of-range archer attack) once then valid — assert correction feedback message includes the engine error text.
3. **Exhaustion**: mock always-failing ⇒ after `moveRetries` (3): `ai_last_error` set, game still `ai_turn`, turn unchanged — then stale-recovery re-triggers (unit-tested with a fake clock? no — stub the timestamp compare; simple).
4. **Serializer**: golden fixture for a snapshot board+units string; verify stable under a config stat change (reads config, so no hardcoded 20/25).
