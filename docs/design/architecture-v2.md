# Pipeline Factory v2 — Architecture (Lucid)

Authored per ADR-007..010. Review gate: these diagrams are approved before v2 code lands.

## Diagrams

| Diagram | Where |
|---|---|
| C4 L1 — System Context | [Lucid page 1](https://lucid.app/lucidchart/65e2c5fe-21ab-443f-a908-b7841d84e76f/edit) |
| C4 L2 — Containers | Lucid page 2 (same document) |
| Data architecture — medallion + metadata plane + recon | Lucid page 3 (same document) |
| Build-flow sequence (contract → PR) | [Lucid sequence doc](https://lucid.app/lucidchart/25711dd8-b6f3-4c6c-9a3b-59c6f381e3b6/edit) |

## Reading guide

**Context (L1).** A data engineer drives Pipeline Factory (Databricks App). The app asks the FMAPI
LLM for specs (JSON only), provisions standard Lakeflow assets on the Databricks platform, and
opens metadata-only PRs on GitHub. Ingestion reaches Salesforce exclusively through a UC connection
(one-time OAuth U2M consent). CI deploys the framework bundle.

**Containers (L2).** Four zones:
- *App*: React SPA (DuBois theme) → Fastify API/SSE → build executor (fix loop) + provisioner
  (drop-guard) + RegistryStore (Lakebase pg pool, warehouse fallback) + CICD adapter.
- *Lakeflow assets (per source, app-provisioned, tagged)*: ingestion pipeline
  `brnz_{source}_ingest` (Lakeflow Connect), ETL pipeline `slvr_{source}_etl` (SDP generic engine),
  workflow `{source}_workflow` (pipeline_task → pipeline_task → recon task, cron).
- *Data & state*: Lakebase Postgres (operational store), SQL warehouse, Delta `ctl` schema
  (dataflow_spec with tombstones, staged_artifacts, recon_* with CDF), bronze/silver schemas,
  UC connection, secret scope, FMAPI endpoint, synced tables.
- *GitHub*: `databricks-ingestion-framework` (engine code, semver) and `databricks-brnz-ingestion`
  (metadata PRs), CI.

**Data architecture.** Salesforce → ingestion pipeline (include_columns from contract, cursor
SystemModstamp, SCD) → bronze → ETL engine (factory loop over `ctl.dataflow_spec`, DQ expectations)
→ silver → adapter views. Metadata plane: app MERGEs specs (is_active tombstones — rows never
deleted). Recon: framework job compares bronze/silver → `ctl.recon_*` → synced tables → Lakebase →
Reconciliation dashboard (ms reads).

**Sequence.** Full happy path + fix loop (spec-delta only, max 3) + needs_human exit; two human
gates (spec approval, PR merge) plus the decommission confirmation gate from ADR-010.

## Key invariants shown

1. LLM emits specs/deltas only; renderer emits metadata only; engine code is versioned in the
   framework repo.
2. Ingestion/ETL/orchestration are standard Databricks primitives (Lakeflow Connect pipeline, SDP
   pipeline, workflow) — nothing bespoke in the data path.
3. `ctl.dataflow_spec` rows are tombstoned, never deleted (SDP drop-on-omission hazard).
4. App state = Lakebase; data plane = Delta; recon read path = synced tables.

## v3 suite (current)

| Diagram | Where |
|---|---|
| L1 System Context · L2 App Containers · L3 Ingestion (workflow v3) · L3 Observability+Storage | [Lucid v3 suite](https://lucid.app/lucidchart/0aad657b-5c89-4f4e-b2d2-40595860ff97/edit) |
| Mermaid mirrors (version-controlled, authoritative) | `docs/ARCHITECTURE_DIAGRAMS.md` |
| Build & fix-loop sequence | Mermaid in ARCHITECTURE_DIAGRAMS.md §L3.2 (supersedes the v2 Lucid sequence) |
