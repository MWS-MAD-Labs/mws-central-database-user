## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Product spec: `Centralized User Database.md`

This is the source-of-truth requirements doc (repo root, ~2000 lines) — field lists, module scope, business rules per domain (student, employee, academic year/class, etc). It's indexed in the graphify graph like any other file.

- Check it (via `graphify query`/`graphify explain`, not a full `Read`) **before product/schema/business-logic decisions**: new fields, required-vs-optional calls, permission models, workflow ordering (e.g. "does X happen at create or as a separate step"). Cross-check against the relevant section before proposing a design, and flag it explicitly if a decision would diverge from spec.
- Skip it for mechanical work that doesn't touch product decisions: refactors, bug fixes, test writing, typo fixes, pure code cleanup.
- Only fall back to reading actual line ranges of the .md file if graphify's scoped answer doesn't surface enough — same escalation path as source code.

## Prisma: never combine a write with a nested `include`

Don't call `create()`/`update()` with an `include` that has its own nested `include` (e.g. `include: { student: { include: { current_grade: true } } }`), whether inside `$transaction` or not. This races on the `@prisma/adapter-pg` client's single connection and throws "Calling client.query() when the client is already executing a query is deprecated". It's silent — tests still pass, only a stray warning shows up, sometimes not even every run.

Instead, do the write bare (no `include`), then fetch relations with a separate `findUnique`/`findUniqueOrThrow` right after. See `student-service.ts` (`create`), `employee-service.ts` (`create`/`update`), `api-client-service.ts` (`create`/`revoke`), `enrollment-service.ts` (all mutations) for the pattern. A flat, single-level `include` (e.g. `{ grade: true, academic_year: true }`) combined with a write is fine — the risk is specifically a *nested* `include`.

## Code comments

Keep comments short and plain — state the fact, skip the explanation unless it's non-obvious. Write them like a normal dev leaving a quick note, not a documentation paragraph.
