# Architecture (v2)

Diagrams: `docs/design/architecture-v2.md` (Lucid — C4 context/containers, data
architecture, build sequence). Decisions: `docs/ADR/` (001–010).
Prescriptive pattern catalog (which primitive per source type, workflow shapes,
per-pattern metadata): `docs/FRAMEWORK_PATTERNS.md`.

## The one-sentence version

An LLM turns interface contracts into **specs**; a deterministic renderer turns
specs into **metadata**; a static, versioned **framework engine** executes that
metadata through standard Databricks primitives — ingestion pipeline → ETL
pipeline → workflow — with recon evidence and human gates around everything.

## Two repos, two planes (ADR-008)

| | code plane | metadata plane |
|---|---|---|
| lives in | `tripsankur/databricks-ingestion-framework` | `ctl.dataflow_spec` rows + metadata-only PRs to `tripsankur/databricks-brnz-ingestion` |
| changes when | engine improves (semver) | a source/entity is onboarded or fixed |
| written by | humans, reviewed | Pipeline Factory (LLM spec → renderer), reviewed |
| contents | generic SDP engine, generic recon job (entry point + key/row/attribute compare), sfdc describe adapter | dataflow.yml per entity + thin resources/{source}.pipeline.yml + manifest + evidence |

Generated code no longer exists — the class of bug where per-source rendered
code drifts from the real engine (found by external review on PRs #1–#4) is
structurally impossible.

## Standard Lakeflow assets per source (ADR-009)

1. `brnz_{source}_ingest` — **Lakeflow Connect managed ingestion pipeline**
   (`ingestion_definition`: connection, objects, `include_columns` from the
   contract, SCD). Sources without a managed connector use the engine's
   Auto Loader path instead.
2. `slvr_{source}_etl` — **SDP declarative pipeline** running the framework
   engine (`libraries: glob → engine`, `configuration: pf.source/pf.spec_table`);
   factory-loops the active `dataflow_spec` rows into bronze→silver stitches with
   DQ expectations.
3. `{source}_workflow` — **Lakeflow Job**: pipeline_task(ingest) →
   pipeline_task(etl); cron from the contract's `batch_schedule`. Scheduled runs
   need no app and no tokens.

The app provisions all three idempotently at build time (find-by-name, tagged
`generated_by=pipeline_factory`), guarded by ADR-010 tombstone semantics: spec
rows are never deleted, the engine reads only `is_active`, and a build that
would implicitly drop a managed dataset fails the drop-guard instead.

## State split (ADR-007)

- **Lakebase Postgres** (`pipeline_factory` schema): app-owned operational
  state — spec_registry, spec_versions, build_runs, llm_calls (with exact
  prompt/response text), contracts. `@databricks/lakebase` pool; warehouse
  fallback keeps every route alive without it.
- **Delta `workspace.ctl`**: the data plane — dataflow_spec (engine input),
  staged_artifacts (audit), recon_runs/entity_result/record_diff (Spark-written,
  CDF on).
- **Synced tables** `pf_lakebase.recon.*`: recon Delta → Postgres (TRIGGERED)
  so the Reconciliation dashboard reads in milliseconds.

## Build flow

render → branch (metadata commit) → spec_upsert (MERGE dataflow_spec) →
provision (3 assets, connection gate, drop-guard) → workflow_run → dq (pipeline
event log, latest update only) → recon (pf-framework-recon job) → PR with
EVIDENCE.md. Failures feed the bounded fix loop: LLM emits a spec DELTA only
(max `MAX_FIX_ITERATIONS`, then `needs_human`).

## Hard constraints (original 8, as amended)

1. Renderer is the sole producer of files; files are declarative metadata (ADR-008).
2. Fix loop emits spec deltas only.
3. The app never deploys beyond dev; prod promotion = customer CI applying the PR.
4. Credentials only in secret scopes / UC connections.
5. Every artifact/table/job tagged `generated_by=pipeline_factory` + spec identity.
6. App is stateless; state = Lakebase (operational) + ctl Delta (data plane) (ADR-007).
7. Two human gates: spec approval, PR merge — plus the ADR-010 decommission gate.
8. CI/CD-agnostic: CicdAdapter boundary; factory.manifest.yml v2 is the contract.
