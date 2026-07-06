# ADR-007: Lakebase Postgres as the operational app store

Status: accepted (2026-07-06)
Amends: hard constraint #6 ("app is stateless; registry Delta tables are the single source of truth")

## Context

Every app route queries the SQL warehouse per request (`dbx.sqlRows`), costing 1–3 s per page. The
registry tables in `workspace.ctl` serve two very different consumers with one storage engine:

1. **The app** — small, hot, transactional reads/writes (spec status, versions, build runs, LLM call
   log). OLTP shape.
2. **Runners / the ingestion engine** — Spark jobs exchanging artifacts and writing recon results.
   Data-plane shape.

Databricks' blessed pattern for production apps (Lakebase GA 2026) is a hybrid: app-owned mutable
state lives in Lakebase Postgres; lakehouse-truth Delta data is *synced* into Lakebase read-only
replicas for fast app reads.

## Decision

- **Lakebase Postgres (autoscaling project `pipeline-factory`, schema `pipeline_factory`) becomes
  the operational store** for app-owned state: `spec_registry`, `spec_versions`, `build_runs`,
  `llm_calls`, `feature_events`, `contracts`. Access via `@databricks/lakebase` pool (OAuth
  auto-refresh); app deployed before resource attach so the app SP owns the schema.
- **Delta `workspace.ctl` remains the data plane**: `staged_artifacts` (app↔runner exchange),
  `dataflow_spec` (read by the SDP engine via Spark), `recon_runs` / `recon_entity_result` /
  `recon_record_diff` (written by Spark recon).
- **Synced tables** (TRIGGERED mode, CDF enabled on sources) replicate the recon tables into
  Lakebase so the Reconciliation dashboard reads in milliseconds. Synced tables are read-only.
- Warehouse fallback: when `PGHOST` is absent or `PF_PG_ENABLED=false`, the store interface falls
  back to the existing warehouse implementation. Every route stays functional without Lakebase.

## Consequences

- Constraint #6 restated: *the app is stateless; all state lives in Lakebase (operational) and
  `workspace.ctl` Delta (data plane) — never in process memory or on disk.*
- Fleet/History/Evidence page loads drop from seconds to milliseconds.
- One-time backfill migrates existing warehouse registry rows into Postgres at first boot.
- New failure mode: Postgres scale-to-zero cold start (~seconds) — mitigated with retry-on-connect.
