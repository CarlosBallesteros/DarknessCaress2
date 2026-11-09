# Audit Triage Record — Darkness Caress II (external pre-phase-1 reviews)

**Round 1** — three chunked passes per model (`pass_*` files).
**Final pass** — one whole-set pass per model after spec-v1 hardening (`final_*.txt`).
**Round 2** — whole-set per model on the post-hardening spec (`round2_*.txt`).
**Round 3** — whole-set per model on the post-round-2 spec (`round3_*.txt`).

Models (both free): Flint 40B Free, Nemotron 3.5 Super VL Free.
Method (held throughout): findings trusted only when BOTH models flag them or hand-verified against the docs; every quote checked against the file before triage. Reports and prompts live in this folder; the record follows.

---

## ROUND 1 (three chunked passes) — ACCEPTED (items 1–28, batched into `docs(review): full external audits…`)

1. `06` ep13 status-vs-victory flip reconciled; `05` client read clarified.
2. `01` turn_number increments-on-failure removed (advances only on successful AI turns).
3. `03` enemy front/back rows inverted → corrected (enemy front = row 1).
4. `02` catalogue vs `04` feedback reconciled.
5. `06` logout exempted from auth conventions.
6. `02` river "simple path" overstated → neighbor-count invariant credited as the guarantee.
7. `00` "rules are complete" → "complete for MVP".
8. `08` "next to the client" → "next to the LLM client (backend)".
9. `06` heal adjacency → Manhattan-1 phrasing.
10. `06` forfeit "idempotent" wording → explicit 409 on finished games.
11. "difficulty" axis traced (`games.difficulty` = persona id).
12. snake_case→camelCase mapping declared (`01`).
13. `00` config-scope list extended (lore, AI knobs) + canonical-shape pointer.
14. `00` stats "history table" wording removed.
15. `00` symmetric defeat sentence added.
16. `00` async bullet → `01` Runtime model pointer; retry bound named.
17–18. misc wording.

**Engine semantics holes:** 19. Landing-tile rule (`02`). 20. Strict sequential resolution (`02`). 21. Missing-targetId → zod discriminated union + catalogue. 22. Omitted-unit semantics (`04`). 23. Test additions `02`/`09`.

**UX/precision:** 24. Health-bar boundaries (`05`). 25. New-game modal 503 + no-timeout (`05`). 26. Preview tiles-only ↔ client path ↔ server re-validation (`06`+`05`). 27. `lastAiActions` lifetime (`06`). 28. Guard synchronous (`01`).

## ROUND 1 — REJECTED (verified auditor error)

1. `hillZones "12-12"` — hallucinated quote (file says `int 2-12`).
2. "Auth mechanics unspecified" / 3. "async mechanism unspecified" — defined in `01`; pass-1 subset couldn't see them (chunking cause; `00` cross-refs added anyway).
4. "pass 3 can't read 06" — intended chunking.
5. "difficulty undefined" — defined in `01`+`06`.
6. "move = steps-total vs relocation" — refuted by `02` (BFS ≤ Mov).

## FINAL PASS (whole-set, post-v1) — ACCEPTED

1. River "zero or one" unrepresentable → `river: null | {}` optional in brief; materializer/invariants conditional; riverless test (`03`).
2. 55 s-guard inside 60 s-staleness = duplicate-job race → ACTIVE-JOB set guard (no time window) (`01`).
3. Preview union vs per-destination UI → client-side Manhattan filter defined (`05`).
4. Counter event → DTO mapping (attackerHp from applied state) (`06`).
5. `GET /api/health` added as endpoint 0 (`06`) — phase 1 mandated it, contract lacked it.
6. Brief temperature → `config.ai.briefTemperature` (`01`/`03`/`04`).
7. "Terrain has no mechanical effect" self-contradiction → water = the one mechanical exception (`00`/`02`).
8. Ownership-404 wording (endpoint-specific leak-free bodies allowed) (`06`).
9. wait-vs-omit acted semantics settled (`02`/`04`/`06`).
10. Placeholder-fallback runtime definition (gray rect + class initial + tint) (`07`).
11. `/api/meta` example ellipsis note (`06`).
12. STATS `/heal<n>` position pinned (`04`).

REJECTED: "no partially acted turn" misread (paragraph answers it); end-turn button "finding" without content.

## ROUND 2 (whole-set, post-hardening) — ACCEPTED

1. **Forfeit-vs-running-job race** → job persistence conditional (`UPDATE … WHERE status='ai_turn'`); forfeit can no longer be overwritten (`01`).
2. **Fallback flag had no storage** → `games.used_fallback` column (internal; not in DTO) (`01`; `09` phase 4 records it).
3. **Failed-job timing** → failure sets `updated_at = now()` (fresh 60 s sweep fuse; no model hammering) (`04`).
4. **`/api/meta` made public** → landing page's `DEFAULT_THEME` = the first theme id served by meta (`01`/`06`/`05`).
5. Staged-move shape in `05` rewritten to the exact `Move` bundle.
6. `assetPath` signature widened: `(themeId, kind, classKey?, side?)` (`07`).
7. Envelope wording clarified (natural top-level keys; no `{"data":…}`) (`06`).
8. UNITS block clarified: BOTH armies, P- = legal targets (`04`).
9. Weapon-triangle hook: "via future spec amendment, never directly in code" (`00`).
10. `04` system template marked "rendered at baseline config".
11. `06` ep13: wait entries count as acted (dialog consequence points at `05`).
12. Stats: flat top-level numbers ARE the totals (`05`).

REJECTED: none factual — one wording tighten (weapon triangle phrasing, folded into item 9).

## ROUND 3 (whole-set, post-round-2) — ACCEPTED (all verified-real; a first: 100% hit rate)

1. `02` path-length arithmetic self-contradiction → length = edges = entries − 1, consistent examples.
2. **Preview membership bug** — ep12 "distance ≤ range" wrongly marked distance-1 tiles attackable for the archer (`[2]`) → set-membership wording (`02`+`06`).
3. **Multi-POST chain-following loophole** → exactly ONE `/moves` per round; second call = 409 "Turn moves already submitted"; 409 row added for non-`player_turn` submissions (`06`) — keeps the landing-tile rule honest across requests.
4. **Dead transition** `ai_turn → won` removed from the matrix (AI can't kill its own army) (`06`).
5. Retry budget arithmetic pinned: ≤ 3 materializations/brief, ≤ 3 briefs, ≤ 9 attempts per POST (`03`).
6. End-turn confirm dialog copy pinned in `05`; `06` mention → pointer.
7. Client path-BFS distinguished from "no duplicated pathfinding" (UX sugar, server re-validates); test renamed "path-SERIALIZING helper" (`05`).
8. Tile-code vocabulary declared: 1-char glyphs = prompt notation only (`04`).
9. `PATCH /api/me` `?` = TS-optional notation (`06`).
10. `turnNumber` = the 1-based CURRENT round (examples stated) (`06`).
11. Lost newline restored in `05`'s state machine (`movePicked → unitSelected`).

REJECTED: none — both reports carried only verified-real items (0 hallucinations for the second consecutive round).

## ROUND 4 (whole-set, post-round-3) — ACCEPTED (all verified-real)

1. **Wait-entry vs landing-tile contradiction** (Nemotron) — a `wait` entry's final tile is the unit's own pre-move tile: literally rejected by path-legality AND the landing rule, while three other passages permit it → self-ownership exception in `02` movement + Wait exemption from the landing rule.
2. **`GameEngineConfig` lacked `count`** (Flint) — "the sum of config counts" was underivable from the engine projection → `count` added as assembly metadata (`02`); combat math still never branches on it.
3. **Retry budget hardcoded in `03` prose** (Nemotron) — 3/3/9 violated the SSOT fence → `config.ai.boardRetries: { materializations, briefs }`; `03` references keys, not numbers (`01`/`03`).
4. **`01` claimed the AI job could write `won`** (Nemotron) — impossible since round 3's dead-transition fix → `(player_turn | lost)` only.
5. **`winRate` undefined at 0 games** (Nemotron) → `wins/gamesPlayed`, floored to 0 (`06`).
6. **Round-2's byDifficulty zero-rows decision had never reached `06`'s text** (Nemotron) → written: every persona always, zeros included.
7. **Empty-bundle + end-turn choreography underdefined** (both models) → empty `{"moves": []}` is a valid submission (applies nothing, consumes the round); choreography uniform: always `/moves` (may be empty) → `/end-turn` (`06`/`05`).
8. **`00` promised the LLM decides "densities"** — no such brief field → wording corrected: zone radii ARE the density knob (`00`).
9. Lost-newline merged bullet repaired in `05` (`- Sprite asset path…` merged into the ai_turn bullet).
10. `09` phase 3's Read list gained `01` (canonical config shape for the projection).
11. Persona behavior texts declared CODE constants (config stays label+temperature only) (`04`).
12. STATS `<class>` token = bare config key; fictional keys exist only as staleness-proofing (`04`).
13. `SIZE = 15` demoted to "hardcoded test/legacy default — canonical value is the config argument" (`02`).

REJECTED: none — every finding verified-real on quote inspection (second consecutive fully-clean round for both models).

## Process notes

- Chunked passes (round 1) miss cross-subset facts; whole-set passes catch cross-file rot but risk attention dilution — both found different bug classes; alternating them worked.
- Two-model intersection ≈ confirmed-real; singles were individually case-checked. All model quotes from round 2 onward were verbatim-accurate; round 1 had one hallucination (caught by verification).
- The division of labor emerged naturally: Flint mines internal wording coherence, Nemotron mines protocol/race conditions.
- Defect yield by internal self-audit passes: 2 → 4 → 3 → 4 → 6 → 4 → converged; each later pass caught progressively shallower (mostly edit-seam) damage.
