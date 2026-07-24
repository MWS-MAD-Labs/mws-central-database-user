# Codex project context

Before working on this repository, read and follow [CLAUDE.md](CLAUDE.md). It is the canonical project guide for product requirements, engineering conventions, and workflow rules.

## Graphify

The project knowledge graph is already built at `graphify-out/`. For codebase or product questions, use `graphify query "<question>"` first. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused context. After modifying code, run `graphify update .` to refresh the graph.

Claude-specific hooks in `.claude/settings.local.json` are not used by Codex. This file provides the equivalent Codex-facing workflow guidance.
