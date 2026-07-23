## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Product spec: `Centralized User Database.md`

This is the source-of-truth requirements doc (repo root, ~2000 lines) field lists, module scope, business rules per domain (student, employee, academic year/class, etc). It's indexed in the graphify graph like any other file.

- Check it (via `graphify query`/`graphify explain`, not a full `Read`) **before product/schema/business-logic decisions**: new fields, required-vs-optional calls, permission models, workflow ordering (e.g. "does X happen at create or as a separate step"). Cross-check against the relevant section before proposing a design, and flag it explicitly if a decision would diverge from spec.
- Skip it for mechanical work that doesn't touch product decisions: refactors, bug fixes, test writing, typo fixes, pure code cleanup.
- Only fall back to reading actual line ranges of the .md file if graphify's scoped answer doesn't surface enough same escalation path as source code.

## Prisma: never combine a write with a nested `include`

Don't call `create()`/`update()` with an `include` that has its own nested `include` (e.g. `include: { student: { include: { current_grade: true } } }`), whether inside `$transaction` or not. This races on the `@prisma/adapter-pg` client's single connection and throws "Calling client.query() when the client is already executing a query is deprecated". It's silent tests still pass, only a stray warning shows up, sometimes not even every run.

Instead, do the write bare (no `include`), then fetch relations with a separate `findUnique`/`findUniqueOrThrow` right after. See `student-service.ts` (`create`), `employee-service.ts` (`create`/`update`), `api-client-service.ts` (`create`/`revoke`), `enrollment-service.ts` (all mutations) for the pattern. A flat, single-level `include` (e.g. `{ grade: true, academic_year: true }`) combined with a write is fine the risk is specifically a _nested_ `include`.

## Code comments

Keep comments short and plain state the fact, skip the explanation unless it's non-obvious. Write them like a normal dev leaving a quick note, not a documentation paragraph.

## Walkthrough docs (`docs/*-walkthrough.md`)

Write like a dev leaving practical notes for a teammate, not an AI assistant explaining itself:

- No em dashes. Use a period, a comma, or restructure the sentence.
- Cut "this exists so..." / "this is because..." padding for every single rule. State the fact, trust the reader. Save the rationale for the genuinely non-obvious stuff.
- Vary sentence length. Not every sentence needs the same balanced two-clause shape.
- Before writing a command or curl example into the doc, actually run it (seed script, the request, the expected response/status code). Walkthroughs are copy-pasteable by design, a plausible-looking but unverified command defeats the point. If a claim depends on timing or DB state (e.g. a grace-period lock), show how to fake that state (e.g. `bunx prisma db execute` to backdate a timestamp) rather than asserting it and moving on.
- When a script/path referenced in the doc changes (e.g. a `package.json` alias gets added), grep the doc for the old form and update it in the same pass, don't leave the doc pointing at a stale path.

## Git commit messages

- Short, concise, clear one line stating what changed and why, not a running log of steps taken.
- Write like a normal dev, not AI-generated boilerplate. No emoji, no "Generated with Claude Code" footer, no restating the obvious.
- Never add Claude as a co-author or contributor no `Co-Authored-By: Claude` trailer, no session links.
- Prefix with the change type and the domain/module it touches, e.g. `feat:student`, `feat:student enrollment`, `fix:constraint conflict`, `refactor:...`, `docs:...`, `update:...` match whatever's already in `git log`, don't invent a new prefix style.

## Branch workflow

- Feature work happens on its own branch (e.g. `feat/student`), never directly on `main` or `deploy/testing`.
- Once a feature branch is ready, merge it into `deploy/testing` first that's what runs on the Komodo server, so merging there is how we confirm the feature actually passes deployment/testing for real, not just local `bun test`.
- Only after `deploy/testing` confirms it's solid, merge `deploy/testing` into `main`.
- Never skip straight from a feature branch to `main`.

## Post-feature review

After finishing a service (and its model/validation/controller/router/test files) or a full feature, do a detailed self-review pass before moving on re-read the new code critically, cross-check it against established patterns elsewhere in the codebase (RBAC, soft-delete, audit logging, race conditions, etc.), and surface any bug or unhandled edge case found. Report findings back before fixing, so we can discuss the right solution together rather than silently patching.
