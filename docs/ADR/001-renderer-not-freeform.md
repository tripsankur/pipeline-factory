# ADR-001: LLM produces specs, a deterministic renderer produces files

**Status:** Accepted · 2026-07-05

## Context
LLMs can generate pipeline code directly, but the output is non-reproducible, hard to
review, and impossible to golden-test. The product must guarantee that identical approved
specs always yield identical artifacts.

## Decision
The LLM's only output is a structured **spec** (or a spec delta), validated by the zod
schema in `packages/core/src/spec.ts`. Files are produced exclusively by the nunjucks
renderer — a pure function `(spec) -> files[]` covered by golden-file tests. LLM-authored
SQL expressions live *inside* the spec as `transform` values, where a reviewer approves
them cell-by-cell in the mapping screen.

## Consequences
- Golden-file diffs are the breaking-change gate for the artifact contract.
- The fix loop can only edit the spec and re-render (see ADR-002 implications).
- New artifact kinds require new templates, not new LLM prompt surface.
