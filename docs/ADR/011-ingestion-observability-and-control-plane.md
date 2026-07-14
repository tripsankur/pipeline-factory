# ADR-011: Ingestion observability + config-table control plane

Status: accepted (2026-07-14)
Related: ADR-007 (state split), ADR-009 (standard primitives), ADR-010 (tombstones)

## Context

v2 telemetry only covered app-initiated builds: `build_runs` rows exist solely for
builds, recon required app-generated correlation ids, and scheduled (cron) workflow
runs landed data with **zero** recorded evidence — no rows-ingested, no parity, a
stale dashboard. Separately, operational knobs (schedule, pause, retries, SLA,
notifications) were buried in `spec.evidence.contract`, invisible and uneditable
after generation. Enterprise metadata-driven ETL separates these into a **control
plane** and an **observability plane**.

## Decision

### Observability plane — every run leaves evidence, app or no app
- New Delta table **`ctl.ingestion_runs`** (CDF): one row per entity per workflow
  run — `run_id` (= the Lakeflow `{{job.run_id}}`), source, entity, trigger_type
  (build|schedule|manual), bronze/silver absolute counts, state, timestamps.
  Rows-ingested per run = count delta vs previous run, computed at read time.
- New Delta table **`ctl.watermarks`**: observed high-water mark per incremental
  entity (cursor column + last value + last run), maintained by the logger —
  audit/replay foundation for engine-owned incremental patterns.
- The **workflow itself carries observability**: tasks `log_run`
  (framework `run_logger.py`) and `recon` (now self-generating its recon_id) run
  after `etl` on EVERY execution, followed by sequential synced-table refresh
  tasks. Scheduled runs therefore produce the same evidence as builds, keyed by
  the same `run_id`, with no app, no tokens.
- The build executor stops invoking recon separately — it reads the recon rows
  its triggered workflow run produced (join on run_id).

### Control plane — batch/job config as first-class, editable tables
- **`ctl.batch_config`** (per source): schedule_cron, timezone, enabled
  (pause/resume), retries/backoff, sla_minutes, notify_emails, full_refresh_cron.
- **`ctl.job_config`** (per source): timeout, max_concurrent_runs, extra tags
  (cost attribution), compute knobs.
- Builds SEED these rows from the contract (INSERT-only — operator edits are
  never clobbered); the provisioner READS them when ensuring assets; the app
  exposes `GET/PATCH /api/config/batches/:source` so schedule/pause/SLA changes
  apply without a rebuild (PATCH re-runs ensureWorkflow).

## Consequences
- Source-to-target recon evidence exists for every run; SLA breaches are
  detectable (`sla_minutes` vs run duration); the dashboard is self-refreshing
  (sync tasks ride the workflow).
- Operations decouple from generation: pausing a batch or changing its cron is a
  config PATCH, not a spec rebuild.
- `dataflow_spec` stays purely *what*; `batch_config`/`job_config` own *when/how
  operated*; `ingestion_runs`/`watermarks`/`recon_*` own *what happened*.
- Reserved future hooks (documented in FRAMEWORK_PATTERNS): quarantine tables,
  PII→UC column tags, drift policy, row-level audit columns, backfill API.
