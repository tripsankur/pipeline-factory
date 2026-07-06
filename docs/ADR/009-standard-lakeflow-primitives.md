# ADR-009: Standard Lakeflow primitives — ingestion pipeline, ETL pipeline, workflow

Status: accepted (2026-07-06)
Supersedes: ADR-002 (runner-jobs) for the ingestion/transform path (runner-jobs remain only for
the framework recon task)
User directive: "All ingestion, ETL should follow Databricks standards. Use Ingestion pipeline,
ETL Pipeline and workflow where needed. It should be Lakeflow Connect itself."

## Context

The MVP executed everything as generic Jobs running `spark_python_task` scripts. Databricks'
standard decomposition is: **pipeline = what (dataflow), workflow/job = when (orchestration)** —
and for SaaS sources, **Lakeflow Connect managed ingestion pipelines** own source→bronze.

## Decision

Per source the app provisions exactly three standard assets (idempotent by name + tag):

1. **Ingestion pipeline** `brnz_{source}_ingest` — a Lakeflow Connect managed ingestion pipeline
   (`ingestion_definition: {connection_name, objects[]}`; per-object `table_configuration` carries
   `primary_keys`, `scd_type`, and `include_columns` from the contract-selected columns). The
   managed connector owns cursoring, SCD handling and schema evolution. Sources without a managed
   connector (files/Delta) use the SDP engine's Auto Loader path instead (source_format switch in
   metadata).
2. **ETL pipeline** `slvr_{source}_etl` — a serverless SDP declarative pipeline running the
   framework's generic engine (libraries glob → engine files; configuration `pf.source`,
   `pf.spec_table`, `pf.env`) for bronze→silver stitch + data-quality expectations, all driven by
   `ctl.dataflow_spec`.
3. **Workflow** `{source}_workflow` — a Lakeflow Job: `pipeline_task`(ingestion) →
   `pipeline_task`(ETL) → recon task, with the cron trigger taken from the contract's
   `batch_schedule`.

**Connection prerequisite:** the managed Salesforce connector authenticates via OAuth U2M only —
the UC connection consent is UI-bound by design. The app treats the connection as a one-time
human-in-the-loop prerequisite: Settings shows live connection status and deep-links to Catalog
Explorer for the one-time authorization. Everything downstream is metadata + API.

## Consequences

- Ingestion appears where Databricks operators expect it (Pipelines / Ingestion UI), with native
  monitoring, expectations UI and event logs — no bespoke ingestion code to maintain.
- The custom Salesforce REST reader is demoted to schema *discovery* (describe) and explicitly not
  an ingestion path.
- The app's build no longer "runs a script"; it triggers the workflow and reads pipeline events for
  DQ results.
- Scheduled/production runs are plain workflow cron runs — no app involvement, no token handling.
