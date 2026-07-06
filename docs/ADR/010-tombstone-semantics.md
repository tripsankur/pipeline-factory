# ADR-010: Tombstone semantics for dataflow specs

Status: accepted (2026-07-06)
Related: ADR-008 (metadata split), ADR-009 (standard primitives)

## Context

SDP pipeline configuration is **additive-declarative**: the set of datasets a pipeline manages is
exactly what its source code defines at each update. If a previously defined dataset disappears
from the metadata the engine reads, the next pipeline update **drops that managed table** from the
target schema. With an LLM writing metadata and MERGE upserts writing `ctl.dataflow_spec`, an
accidental row deletion or filtered-out row would silently destroy production tables.

## Decision

- Rows in `ctl.dataflow_spec` are **never deleted**. Decommissioning an entity sets
  `is_active = false` (tombstone) plus audit columns.
- The engine reads only `is_active = true` rows — and logs every tombstoned dataflow_id it excluded
  at each pipeline init, so drops are always attributable.
- The app's provision step enforces a **drop-guard**: before triggering a workflow run it asserts
  that the active spec set for the source is a superset of the previously provisioned entities,
  unless an explicit decommission was confirmed by a human in the app (separate confirmation gate —
  a third human gate alongside spec approval and PR merge).
- The fix loop may alter columns/expectations via spec deltas but may never change `is_active`.

## Consequences

- Managed-table drops can only happen through an explicit, audited human decision.
- `dataflow_spec` grows monotonically; history is preserved (pairs with spec_versions audit).
- Re-activating an entity is a metadata update (`is_active = true`), not a re-onboarding.
