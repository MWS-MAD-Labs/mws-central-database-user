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
