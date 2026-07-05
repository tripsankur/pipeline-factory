# ADR-005: Spec schema derived from handoff v2 §6 summary

**Status:** Accepted · 2026-07-05

## Context
Handoff v2 says "port the pydantic models to zod 1:1" from v1 §5, but the v1 document was
not provided at build time.

## Decision
`packages/core/src/spec.ts` derives the schema from the v2 §6 field list (spec_id, source,
target, ingestion, crosswalk, columns[] with transform/value_map/confidence/rationale/
compare, expectations[], evidence). Registry DDL likewise derives from the v2 table list.
LLM prompts are written fresh (v1 §7 prompts unavailable).

## Consequences
- When the v1 doc surfaces, diff it against `spec.ts` and reconcile — expected cost is
  small (field-level renames), but golden files will need regeneration if shapes change.
