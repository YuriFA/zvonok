# ADR 0006: Remove living architecture docs; specs and ADRs are the only docs

> **Status:** accepted
> **Date:** 2026-09-15

## Context

ADR 0001 established `docs/architecture/` as living plain docs (C4 diagrams,
sequences, domain model) alongside OpenSpec specs, and froze pre-OpenSpec
history in `docs/archive/`. In practice the living layer drifted: after the SDK
extraction the frontend C4 still shows the pre-extraction SPA layering, and
nothing keeps diagrams synchronized with specs. The repo already holds behavior
in `openspec/specs/` and decisions in `docs/adr/`; user-facing guides
(quickstart, egress, whiteboard, deployment, roadmap, api-reference, docs site)
serve their own audience and stay current because changes update them by task.

## Decision

Delete `docs/architecture/` and `docs/archive/` (content remains recoverable
from git history). The documentation model is now:

- behavior: `openspec/specs/` (source of truth) and `openspec/changes/` (deltas);
- decisions: `docs/adr/`;
- user-facing guides: `docs/*.md` + docs site.

When a change or ADR needs a diagram, it lives inside that ADR or change, not
in a separate living tree. This supersedes ADR-0001's "architecture docs stay
living plain docs" clause; ADR-0001 itself remains as history.

References updated in: `README.md`, `AGENTS.md`, `openspec/config.yaml`,
`apps/client/README.md`.

## Consequences

- Agents and contributors must not re-create living architecture docs; the
  temptation to "update the C4" resolves to "update the spec or write an ADR".
- Stale-diagram risk is eliminated by construction instead of by discipline.
