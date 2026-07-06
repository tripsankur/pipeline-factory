# ADR-008: Framework / metadata split — generated artifacts are metadata, never code

Status: accepted (2026-07-06)
Amends: hard constraint #1 ("the renderer is the sole producer of files")
Related: ADR-001 (renderer-not-freeform), ADR-009 (standard Lakeflow primitives), ADR-010 (tombstones)

## Context

The MVP rendered seven *code* files per entity (silver_stitch.sql, recon_job.py,
bundle_resource.yml, …). External review (Codex, PRs #1–#4 on databricks-brnz-ingestion) found the
shipped `recon_job.py` had no entry point (deployed recon = silent no-op) and never used its
`COMPARE_COLUMNS` — while the app's *internal* recon runner was correct. Root cause: per-source
generated code inevitably drifts from the real engine. Industry answer (Databricks Labs `dlt-meta`,
now in official docs): one static, versioned engine + per-source **metadata**.

## Decision

Two layers:

1. **Framework repo `tripsankur/databricks-ingestion-framework`** (static, semver-versioned):
   generic SDP ETL engine (`engine/ingest_pipeline.py` — reads `ctl.dataflow_spec` rows for its
   source group and factory-creates datasets), generic recon job (`engine/recon_job.py` — with a
   real `__main__` entry point, parameters, and attribute comparison), discovery adapter, its own
   DAB + CI. Deployed once to a stable /Workspace path; never regenerated per source.
2. **Metadata, generated per source by the app's FMAPI → renderer**: `metadata/{source}/{entity}/
   dataflow.yml`, a thin `resources/{source}.pipeline.yml`, `factory.manifest.yml` (v2) and
   `EVIDENCE.md` — committed as PRs to `databricks-brnz-ingestion`. The same spec is MERGEd into
   `workspace.ctl.dataflow_spec`, which is what the engine actually executes.

## Consequences

- Constraint #1 restated: *the renderer remains the sole producer of files; rendered files are
  declarative metadata, never executable code. The LLM still only emits specs/spec-deltas.*
- The Codex bug class (generated code drifting from engine behavior) is structurally impossible.
- PRs shrink to reviewable metadata diffs; one engine fix benefits every source at once.
- New coupling to manage: spec-schema ↔ engine version (`framework_min_version` per spec row;
  engine asserts at init).
- Old per-source `pipelines/` tree in databricks-brnz-ingestion is deprecated; PRs #1–#4 closed as
  superseded.
