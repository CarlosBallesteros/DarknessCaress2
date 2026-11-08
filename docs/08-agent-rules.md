# Agent Rules — the Fence

> **Every agent, every task, reads this file BEFORE writing any code.** It defines what you (the agent) may decide and what you must never touch. Violating the fence is the single most expensive failure a project like this can suffer, because it silently changes the product.

## The mission in one sentence

Implement the phase you were handed, exactly as the specs describe it — nothing less because you were told exactly, nothing more because you were told the scope.

## Hard rules (MUST)

1. **The docs are law.** `00-project-overview.md` + this file are always in context. Then add only the phase files your prompt tells you to read. Do not go hunting for meaning beyond them.
2. **Never decide a product question.** Stats, endpoints, difficulty names, stack choices, schemas, file trees — all of these are already decided in the docs. Your job is transcription into code, not design.
3. **All tunables come from the config file.** If you catch yourself writing a number that describes game balance (HP, damage, movement, temperature, cap, board size…) as a literal in code other than the config file itself, you have broken the project. The config is the ONLY place.
4. **Respect the repo layout in `01-architecture.md`.** Do not reorganize, rename, or "improve" structure. Follow it even where it feels unusual to you — the layout is deliberate.
5. **Simplest thing that satisfies the spec.** No speculative abstractions, no "plugin systems", no interfaces with one implementation, no caching layers, no logs beyond obvious debugging value. If the spec doesn't ask for it, it doesn't exist.
6. **Dependencies are frozen.** Use the exact libraries named in `01-architecture.md`, at the major versions given. Never add a dependency without an explicit instruction to do so; version bumps are owner decisions made in the docs (`01`), never agent-initiated — if a version blocks you, THAT is a gap (rule 7), not a problem to solve by upgrading.
7. **Gaps → stop and ask.** If a spec conflict, ambiguity, or missing piece blocks you, stop and report back with: (a) what is ambiguous, (b) the 2 simplest candidate solutions, (c) your recommendation. **Never fill the gap silently.**
8. **Self-verify before claiming done.** When you finish a phase, run its acceptance checklist (in `09-build-order.md`). Report test results honestly — a failing checklist is not "done".
9. **Follow the explicit examples.** Where a doc shows a concrete artifact (folder tree, snippet, JSON payload, prompt), that shape is the requirement — replicate it, do not restyle it.
10. **Match the existing code style** of files already in the repo; when starting fresh, style = clearly idiomatic TypeScript, small modules, explicit types on boundaries.
11. **Quality gates are part of done.** Lint (ESLint) + formatting (Prettier) clean, unit tests passing (Vitest), and E2E tests (Playwright) passing where the phase defines them. A phase ends with conventional-style commits scoped to the phase and a push to the remote — never with a dirty working tree.
12. **English everywhere in artifacts**: code, identifiers, comments, commit messages, docs-tech. Conventional-style commit messages; no AI attribution ("Co-Authored-By" or similar) ever.

## Hard fences (MUST NOT)

- No websockets, no queues (Redis/RabbitMQ/etc.), no Docker features beyond what `01-architecture.md` describes.
- No SSR, no SEO, no Next.js, no meta-framework. Plain React + plain Express are chosen on purpose.
- No deterministic heuristic that plays the enemy army. No "smart fallback AI". The LLM is the only opponent brain; only validation + retry exists.
- No unit-stat values, class behavior, difficulty text, or UI copy as inline code literals — they belong in config/assets.
- Do not modify or reinterpret `06-api-contract.md`. If an endpoint seems wrong for your task, stop and ask.
- Do not "anticipate" later-hooks features (hidden triangle, sound, themes to come, variable boards) in the code — the only mechanism for the future is the **config + asset convention**, which must remain pluggable. Prepared-but-hidden features require actual spec text first.
- Do not generate or commit real artwork. Placeholder art only (see `07-assets.md`).
- Do not write long-lived infrastructure helpers, global registries, or cross-cutting "frameworks inside the project".

## Gap protocol — exact shape

When blocked or unsure:

```
STOP
WHAT IS BLOCKING: <one sentence>
SPEC QUOTE: <the line(s) you read that leave the gap>
OPTIONS:
  A) <simplest solution>
  B) <other simple solution, if genuinely different>
RECOMMENDATION: A or B, with the one-sentence why.
```

Wait for the owner's answer. Do not proceed on assumptions.

## Style of the code you produce (for consistency across agents)

- TypeScript strict mode, both sides.
- Small files with clear names; one responsibility each; prefer several small files over one "manager".
- Comments explain WHY when non-obvious; never narrate WHAT.
- No dead code, no commented-out blocks, no TODOs unless the phase spec demands them.
- Validation errors are precise and user-facing-safe ("Archer cannot attack a unit at 3 tiles", not stack traces) — validation messages live with the validator.
- Prompts sent to the LLM live in the files `04-ai-integration.md` dictates, as constants next to the client, versioned like code.

## What "done" means

1. The phase's acceptance checklist (from `09-build-order.md`) passes, as shown in your report.
2. `npm run build` / `tsc --noEmit` (or the phase's stated equivalents) are clean.
3. The changes touch ONLY the phase's scope — nothing else was "helpfully fixed".
4. The report states what you built, what you did NOT build (everything not in scope), and any gaps escalated.
