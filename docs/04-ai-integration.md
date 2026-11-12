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

- Real implementation: `POST {OLLAMA_URL}/api/chat` with `{ model: OLLAMA_MODEL, messages, stream: false, format: <schema>, options: { temperature, num_predict: 2048 } }` (`messages` passed straight through). **`num_predict` is mandatory (generation cap), and it must be GENEROUS — real-play evidence (v3, 7B): a 1024 cap truncates legitimate turn replies mid-JSON (grammar-constrained output is always syntactically JSON; the ONLY way it fails the schema is truncation), producing a schema-fail retry loop that never resolves. 2048 tokens covers the largest legal response (10 bounded moves × bounded paths, verified against real prompts) while prompt + 2048 stays inside the 4096 ctx window — hitting the cap yields an unparsable/truncated reply, which is simply a failed attempt in the retry loop below (bounded), never a hang.** Response: `body.message.content` — parse JSON. Non-2xx or unparsable ⇒ throws typed `LlmError`; caller counts it as a failed attempt, never as a crashed process.
- **Mock implementation** (`mockLlm.ts`, same interface): returns recorded/fixture JSON responses. Selection: the test runners (Vitest/Playwright configs) inject `LLM_MOCK=1` automatically — every automated run is mocked by definition; in day-to-day local dev, `LLM_MOCK=1` set once in the local `.env` selects it; production `.env` NEVER sets it. Two implementations, chosen explicitly; no plugin system.
- **Fixtures are committed, not invented at test time** — `features/ai/__fixtures__/`, one file per family: `brief.valid.json`, `turn.valid.json`, `turn.malformed.json`, `turn.illegal.json` (an out-of-range attack), `turn.exhausting.json` (always-fails). The mock serves them by name; their CONTENT is authoring-agent choice (any shape-valid payload works), but the five families and names are the contract — the retry/exhaustion tests consume exactly these. Load them via the project's runtime-asset pattern (`new URL("...", import.meta.url)`, as `src/config/config.ts` does) so they resolve in BOTH `src/` and the shipped `dist/` (`tsc` does not copy JSON).
- **Standalone mode (the mocked client serving a manually-run server, no test driver):** `turn()` does NOT serve coordinate-bound fixtures — it computes a **deterministic minimal-legal turn from the current game state**: sort own (enemy) units by id, take the first, compute its reachable tiles with `src/game/reach.ts`, move to the first adjacent free tile (`to: [x,y]`, destination-only — the job expands the path) or wait if fully surrounded; all other units omit (omission is explicitly legal). Deterministic given the state; shape per the contract; the engine re-validates everything. Static coordinate fixtures remain a TEST-DRIVER privilege (the Vitest/Playwright queue) — they must never be served against live scattered boards.
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
  - /heal<n> is appended only for classes with a config healAmount (baseline: /heal8) —
    always at the END of the line, after /role.
  - role: attacker = melee frontliner; supporter = fragile high-value backline unit —
    the aggressive commander's priority target. Tag semantics are a game decision:
    "supporter" means kill-priority backline, not literal non-combatant (archers and
    mages still attack). Values come from config at build time.
  - one line, classes in config-key order, separated by " | ". The `<class>` token is always the bare config KEY (`sword`, `axe`, …) — the fictional keys in the example below exist only so no value can be mistaken for shipped truth:
  Shape example, with FICTIONAL values on purpose (nothing here is config truth —
  the shipped prompt carries only the real numbers read from config.json at that moment):
  a-goon=hp40/atk3/def2/mov1/rng2,4/role-supporter/heal2 | z-mini=hp9/atk6/def1/mov5/rng1/role-attacker

UNITS: BOTH armies, id=class x,y hp/maxHp
  your side = enemy (ids start with "E-"); the player's units (ids "P-…") are your legal targets

MENU (GENERATED by the engine from the same snapshot — the model NEVER does grid
  math; one line per YOUR surviving unit, in id order):
  Format, exactly:
  - a unit with attack options: <unitId> @ x,y → attacks: <P-id> to(x,y)(x,y)… | moves: (x,y)(x,y)…
  - a unit with heal options:  <unitId> @ x,y → heals: <E-id> to(x,y)(x,y)… | moves: (x,y)(x,y)…
  - a unit with neither:       <unitId> @ x,y → moves: (x,y)(x,y)…
  - `attacks`/`heals` are PAIRED OPTIONS: for each target, the `to(x,y)` tiles
    are the reachable destinations from which THAT target is legally in range
    (capped at 3 per target, engine-computed). The model copies a target id AND
    one of its listed to-tiles verbatim — pairing judgment is the ENGINE's,
    never the model's. A unit with attack options does NOT get a bare
    reachable list: its `to` options are the paired ones (advancing elsewhere
    this turn is pointless for it).
  - `moves` (units WITHOUT attack/heal options only) = the reachable tiles,
    capped at 12 — the movement menu for advancing.
  - A unit whose line has NO attacks/heals section CANNOT attack or heal this
    turn — every player unit is beyond its maximum reach. Such a unit MUST NOT
    emit attack/heal at all; its only options are its listed moves or wait.
    The engine rejects any attack order for it (the closest player unit is out
    of range) and the whole bundle retries — never guess an attack.
  - Expansion is server-side (docs/02 `pathTo`): the model cannot emit an
    illegal route because it never emits a route at all.
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
Produce THIS TURN's orders for your units. Reply ONLY with JSON:
{"moves":[{"unitId":"E-…","to":[x,y],"action":{"type":"attack","targetId":"P-…"} | {"type":"heal","targetId":"E-…"} | {"type":"wait"}}]}
- `to` = the DESTINATION, copied verbatim from one of the unit's PAIRED options:
  an attack order pairs the listed target id with one of ITS to(x,y) tiles; a
  heal order does the same from `heals`; a move order takes a tile from
  `moves`. The server builds the walked route; you never write a path.
- Omitting `to` means stay in place (your current tile is always legal).
- Attack ONLY a target listed in that unit's attacks line, AND end on one of
  that target's listed to-tiles — the pairing is what makes the attack legal.
  A unit whose menu line has NO attacks/heals section cannot attack or heal
  this turn at all — any attack/heal order for it is ILLEGAL and rejected;
  give it a move or wait instead.
- you may list unit orders in any order; omitting a unit means it does NOTHING
  this turn (stays un-acted — equivalent in effect to waiting, but the two are
  distinct paths: an explicit wait marks the unit acted).
- If two of your orders pick the SAME `to` tile, the second is rejected
  (claiming is exclusive) — give each unit its own destination.
- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.
```

**The persona is a MENU-CHOICE POLICY** (v3 amendment — personas now differ in
HOW they pick from the same engine-generated options, not just by temperature;
the behavior text is a code constant per docs, config carries only label +
temperature):
- **Aggressive:** for every unit with `targets`, attack the listed target
  closest to it and choose the reachable `to` that brings it nearest its
  target; units with no reachable target advance `to` the reachable tile
  closest to the nearest player unit; the healer stays back and heals.
- **Defensive:** hold the spawn rows — choose `to` tiles that maximize distance
  from player units (stay behind your own lines); attack ONLY when a target is
  reachable WITHOUT advancing into the open; protect the healer.
- **Erratic:** no policy — pick any listed option however temperature 1.2
  samples it; the persona text only says "the wind decides" flavor while the
  menu keeps every pick legal.

### Response validation loop (bounded, exact)

```
attempt = 1..config.ai.moveRetries (3):
  1. llmClient.turn(messages, temperature = personality.temperature)
  2. zod (discriminated union): { moves: [{ unitId: string, to: [x,y]?,
       action: {"type":"attack","targetId":string} | {"type":"heal","targetId":"E-…"} | {"type":"wait"} }] }
      — attack/heal REQUIRE targetId; wait must not expect one; `to` omitted =
      stay in place. Schema-fail →
       message to model: "Your reply was not valid JSON matching the schema.", retry.
       **BOUNDS ARE PART OF THE SCHEMA (grammar-forced generation — learned from the
        7B/3B spin incident):** `moves` carries `maxItems = <the acting side's unit
        count>` (from the game state at call time — config, never a frozen literal)
        and each `path` carries `maxItems = <boardSize²>` (from config, 225 baseline).
        Ollama's `format` field turns the schema into a decoding grammar: an
        unbounded array is legally ENDLESS there — a small model never "decides" to
        stop emitting move objects and spins to the context ceiling (measured: 20
        minutes at ~6 tok/s, bundle unparsable, retry, repeat). With `maxItems` the
        grammar physically closes the array at the bound, so the model CANNOT spin;
        the `num_predict` cap is the second belt. **`path` maxItems = the largest
        `mov` across `config.classes` + 1** (6 at baseline) — NOT boardSize² (the
        original conservative bound): any path with more edges than `mov` is
        engine-illegal anyway ("path length N exceeds movement M"), so the wider
        grammar only let models WANDER paths and burn minutes per attempt (real-play
        evidence: 900 s per turn cycle at 225-entry grammar room; after the bound,
        replies are ~300–500 tokens ≈ 1–2 min). The zod schema and the JSON Schema
        in `format` stay in lockstep (zod remains the authority). **The discriminated
        action union MUST be `oneOf` in the `format` schema, never `anyOf`** (real-play
        evidence, ollama 0.40.16): the grammar converter mishandles `anyOf` — required
        sibling properties (e.g. `path`) silently become optional, so models emit moves
        WITHOUT `path`, failing zod on every attempt (an unresolvable loop);
        `oneOf` — the correct construct for a closed discriminated union — compiles
        correctly and enforces every required field. This applies to EVERY union in
        every `format` schema (the board brief's null|object river/lake unions had the
        same latent hole — switched to `oneOf` proactively). **With the menu amendment
        (below) the reply no longer carries `path` at all** — `to` is a single
        coordinate pair, so replies are ~150–300 tokens and the old path-bound story
        is historical record only.
  2b. EXPANSION (deterministic, engine-owned — never model-computed): for each
      order, `to` (or the unit's current tile when omitted) is expanded to the
      full legal path via `src/game/reach.ts` → `pathTo(board, units, unit, to,
      cfg)` (docs/02). `pathTo` null (destination not standable in the snapshot
      — possible only when the model ignored the menu) ⇒ engine-rejection
      message to the model, retry. The expanded bundle then runs through the
      NORMAL applyMoves machinery — the EVOLVING landing rule, exclusive
      claims, and every other engine rule govern the expanded paths exactly as
      they govern player paths. The PLAYER contract (endpoint 13) is
      UNCHANGED: players always submit full paths; destination-only moves are
      the AI's internal wire format only.
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
- Prompt strings live in code as named constants — `features/board/briefPrompt.ts` (03) and `features/ai/turnPrompt.ts` (04) — versioned like source, never generated on the fly from game strings besides the swapped values specified above; the STATS block is the sole config-derived part, emitted by one shared helper (`statsKernel(config)`), reused by both docs' prompt builders. Persona BEHAVIOR TEXTS are also code constants in `features/ai/` — config carries only `label` + `temperature` per personality (the config stays pure data; prose never enters it).
- Logs: on success record `{gameId, durationMs, promptChars, responseChars, attempt}` only. Full request/response pairs print only during local/dev runs; production never logs or DB-stores them.
- The serializer output for a mid-game state (some units dead, low HP) must still fit comfortably in the model's context window: worst case ≈ 15 board rows + 1 STATS line + 20 unit lines + prompt text < 4 KB ⇒ fine for 7–8B models.

## Tests

1. **Engine loop with mock LLM**: fixture state + fixture valid response ⇒ success path, events order, DB persistence shape.
2. **Retry loop**: fixture returns: (a) malformed JSON once then valid; (b) illegal move (out-of-range archer attack) once then valid — assert correction feedback message includes the engine error text.
3. **Exhaustion**: mock always-failing ⇒ after `moveRetries` (3): `ai_last_error` set, game still `ai_turn`, turn unchanged — then stale-recovery re-triggers (unit-tested with a fake clock? no — stub the timestamp compare; simple).
4. **Serializer**: golden fixture for a snapshot board+units string; verify stable under a config stat change (reads config, so no hardcoded 20/25).
5. **STATS kernel**: `statsKernel(config)` output matches the documented format; mutate the config (e.g. archer range `[2]` → `[2,3]`, or add a class) → the emitted STATS line changes accordingly, the digest/persona texts do NOT, and no test breaks.
6. **Role tag**: the STATS kernel exposes `role` per class; persona texts never name which classes are supporters — retag a class (e.g. mage → attacker) in config and the kernel + any tag logic change with it.
