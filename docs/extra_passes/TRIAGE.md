# Audit 1 — Triage record (external pre-phase-1 review)

Models used (both free): Flint 40B Free, Nemotron 3.5 Super VL Free. Three passes each, same prompt.
Method: findings are trusted only when BOTH models flag them or when verified against the docs by the owner; single-model findings were individually case-checked. Every quoted finding was verified against the file before triage.

## ACCEPTED → fixed in spec (docs(review) commit)

### Cross-doc / contradictions
1. `06` endpoint 13 said status stays `player_turn` while victory-on-moves flips to `won` → reconciled (won short-circuit allowed in 13's response; `05` clarified what the client reads).
2. `01` said turn_number increments on AI-job failure; `04` said unchanged → fixed to unchanged (counter = "rounds played", advances only on successful AI turns; `06` endpoint 14 now states it).
3. `03` spawn layout formula had the ENEMY front/back rows inverted (row 0 front vs row 1 front) vs its own slot table and `04`'s example → corrected: player front 13 / back 14, enemy front 1 / back 0.
4. `02` catalogue message vs `04`'s richer feedback example read as two contracts → `04` now explicitly wraps the `02` string.
5. `06` conventions demanded cookie auth on ALL non-login endpoints but endpoint 3 (logout) must work logged-out → logout exempted in conventions.
6. `01` "public config subset" vs `06` meta requiring auth → settled: "public" means public to AUTHENTICATED users (it stays in `06`'s auth column; noted for future readers here).
7. `02` claim that simple-path "structurally prevents" river defects overstated (a simple path can self-touch, producing 3-neighbor tiles) → `03` now credits the neighbor-count invariant as the real guarantee.
8. `00` "rules are complete" vs the weapon-triangle later hook → reworded "complete for MVP".
9. `08` "next to the client" → "next to the LLM client (backend only)".
10. `06` heal adjacency wording ("adjacent-to-reach" vs "healer adjacency") → both now Manhattan-1 phrased.
11. `06` forfeit "idempotent" wording was incoherent → explicit: forfeit on a finished game = 409.
12. "difficulty" axis in stats/strip is now traced: `games.difficulty` = persona id (`01` schema), labels via `/api/meta`.
13. Serpentine naming gap DB snake_case → DTO camelCase: mapping function per feature declared in `01`.
14. `00`'s config-scope list omitted lore + AI knobs; added, plus pointer to `01`'s canonical JSON shape.
15. `00` stats "history table" wording (no such table) → replaced (pre-existing fix, audit confirmed).
16. `00` victory was player-phrased only → symmetric defeat sentence added.
17. `00` async bullet now points at `01`'s Runtime model; retry bound now named (`config.ai.moveRetries`).
18. `08` gap/report item: nothing to change — worked as designed.

### Engine semantics holes (would have split across phase agents)
19. **Landing-tile rule** added to `02`: bundle final tiles must be distinct and empty in the pre-move state (no stacking, no chain-following).
20. **Strict sequential resolution** declared: each entry (move+action+counter) completes before the next; a unit killed by a counter never executes a later entry.
21. **Missing/misplaced targetId** → zod discriminated union in `04`; new rejection messages in `02`'s catalogue; test added.
22. **Omitted-unit semantics** clarified in `04`: omitting = doing nothing (stays un-acted).
23. Manual two-phase budget and mutatconfig self-validation test items extended in `02`/`09`.

### UX/aesthetic/spec-precision
24. Health-bar boundary case defined (green > 2/3; amber ≥ 1/3; hidden at full HP) — `05`.
25. New-game modal now specifies `503` handling and the no-timeout loading state — `05`.
26. `06` preview returns tiles only; client-side display path is expected; server re-validates the staged path — `06` + `05` reconciled.
27. `lastAiActions` lifetime defined (replaced by next AI turn; never re-animated) — `06`.
28. Map guard made synchronous (check-and-set before any await) — `01`.

## REJECTED (auditor error or out-of-scope audited subset; no spec change)

1. `hillZones centerY "12-12"` (Flint pass 3) — hallucinated quote; actual file says `int 2-12` (verified).
2. "Auth mechanics unspecified" (Nemotron pass 1) — fully specified in `01` Auth mechanics; pass 1's doc subset couldn't see it.
3. "Async turn processing mechanism unspecified" (both pass 1s) — specified in `01` Runtime model; same pass-1 visibility cause; the READ was answered by adding `00` cross-refs anyway.
4. "Pass 3 couldn't read 06" (Flint pass 3) — intended chunking; cross-references re-checked manually.
5. "difficulty undefined" (Nemotron pass 3) — defined in `01` schema comment + `06` endpoint 8; visibility cause (out of pass subset). VW noted: the wire appears once clarified in `05`.
6. Move interpretation "steps total vs relocation" (Flint pass 1) — `02` fully defines reach by BFS ≤ Mov; refuted.

## Final pass — whole-set audits (both models, post-triage files)

Prompt: single-pass all-files template (reports: final_flint.txt, final_nemotron.txt). Verified-then-triaged:

ACCEPTED (fixed in spec):
1. River "zero or one" was unrepresentable — brief schema made `river: null | {...}` optional; materializer/invariants made conditional (both models' intersection concern).
2. 55s guard inside 60s staleness = duplicate-AI-job race when a slow job outlives 60s → guard is now an ACTIVE-JOB set (entry added synchronously, removed on completion, no time window).
3. Preview attackTiles = union over all destinations vs per-destination UI → client-side filter defined (Manhattan arithmetic from the chosen destination using config ranges; no duplicated pathfinding).
4. Counter event → DTO mapping unspecified → `06` DTO comment now defines the flip (attackerHp read from applied state, never recomputed client-side).
5. `GET /api/health` mandated by phase 1 but absent from the contract → added as endpoint 0 (no auth).
6. Brief temperature 0.8 hardcoded in prose → `config.ai.briefTemperature` added; `03`/`04` read from config.
7. "Terrain has no mechanical effect" self-contradicted by water impassability → reworded in `00`/`02` (water is the one mechanical exception).
8. Ownership 404 wording ("Not found" vs "Unit not playable") → conventions explicitly allow endpoint-specific leak-free bodies.
9. wait-vs-omit acted semantics settled → explicit wait marks acted (end-turn confirm keys off it); omit stays un-acted; documented in `02`/`04`/`06`.
10. Placeholder fallback UNSPECIFIED ("renders placeholder fallback (see below)" pointed at generator files) → runtime fallback defined: gray rect + class initial + side tint, `07`.
11. `/api/meta` example listed only 2 classes → ellipsis note added (`06`).
12. STATS `/heal<n>` position pinned (appended after `/role`) — `04`.

REJECTED:
- "No partially acted turn" ambiguity misread (paragraph answers it) — Flint.
- End-turn button semantics "finding" without content — Flint.

Process note: the whole-set pass found 4 findings the three targeted passes missed (items 1-4 above = would have bitten phase 4/6 hardest). Attention dilution is real, but a full-corpus read catches ITS OWN class of cross-file rot. Two models agreed on items 1-2 — both free.

