# Framework Patterns — the defined shapes for ingestion

This is the prescriptive companion to `ARCHITECTURE.md`: **every source onboarded
through Pipeline Factory maps to exactly one bronze pattern below**, always wrapped
in the same orchestration, lifecycle and evidence conventions. New source ≠ new
design meeting — pick the row, fill the metadata.

Companion docs: `ARCHITECTURE.md` (system shape), `docs/ADR/007–010` (decisions),
`CONTRACT_FORMAT.md` (intake), `CICD_CONTRACT.md` (promotion),
`docs/design/architecture-v2.md` (Lucid diagrams).

---

## 0. The invariants (apply to every pattern)

| Invariant | Mechanism |
|---|---|
| Behavior is metadata, never code | one row per entity in `ctl.dataflow_spec`; engine code lives once in `databricks-ingestion-framework` (semver) |
| Standard primitives only | ingestion pipeline (Lakeflow Connect) / SDP pipeline / workflow — nothing bespoke in the data path |
| One workflow per source | `{source}_workflow` owns *when*; pipelines own *what* |
| Naming | `brnz_{source}_ingest` · `slvr_{source}_etl` · `{source}_workflow` · tables `bronze.{source}_{entity}` / `silver.{entity}` |
| Columns governed by contract | v1.1 `selected` columns → `include_columns` / `select_columns`; discovery keeps the contract true to the source |
| Lifecycle | rows tombstoned (`is_active=false`), never deleted; drop-guard blocks implicit drops; decommission = explicit human gate (ADR-010) |
| Evidence | DQ expectations from metadata + framework recon (key/row/attribute) + metadata-only PR with EVIDENCE.md |
| Versioning | `framework_min_version` per spec row; engine fail-fasts on skew |

---

## 1. Bronze pattern catalog

### Decision table

| Source type | Pattern | Bronze owner | `source_format` |
|---|---|---|---|
| SaaS with a managed connector (Salesforce, Workday, ServiceNow, SQL Server via gateway…) | **P1 Managed ingestion** | Lakeflow Connect pipeline | `lakeflow_connect` |
| Files landing in cloud storage / volumes (csv, json, parquet…) | **P2 Auto Loader** | framework engine (streaming table) | `cloudfiles` |
| Data already in Delta (another team lands it; migration sources like aLDM) | **P3 Pre-landed Delta** | nobody — consume-only (or engine snapshot from `raw_table`) | `delta` |
| Database CDC at scale (SQL Server, Oracle…) | **P4 CDC gateway** *(planned)* | Lakeflow Connect gateway + ingestion pipeline | `lakeflow_gateway` |
| Salesforce **Data Cloud** orgs, ad-hoc "as-of-now" queries | **P5 Zero-copy federation** *(complement, never bronze)* | none — foreign catalog | n/a |

### P1 — Managed ingestion (Lakeflow Connect) ← **Salesforce uses this**

The zero-*code* bronze: the connector owns cursoring, SCD, soft deletes and
additive schema evolution; our metadata owns *which* objects and columns.

- **Asset**: pipeline `brnz_{source}_ingest` with
  `ingestion_definition: { connection_name, objects: [{ table: { source_schema: "objects",
  source_table, destination_*, table_configuration: { primary_keys, scd_type,
  include_columns } } }] }` — all derived from the contract; `include_columns`
  = the contract's selected columns.
- **Prerequisite (one-time, human)**: the UC **connection**. For Salesforce the
  managed connector accepts OAuth **U2M only** — consent happens once in Catalog
  Explorer; there is deliberately no headless path. The app's connection gate
  fails the build with instructions until it exists; contract carries the name as
  `secret_scope: "uc:<connection>"`.
- **Cursor / SCD**: `SystemModstamp → LastModifiedDate → CreatedDate` priority;
  `SCD_TYPE_1` default, `SCD_TYPE_2` when the contract demands history.
- **Known limits** (design around, don't fight): hard deletes need a full
  refresh; ~250 objects/pipeline soft limit; no real-time; formula fields default
  to snapshot semantics.
- **Not this pattern**: custom REST/Bulk readers. Retired (ADR-009); the only
  REST remnant is *schema discovery* (describe) for contract v1.1.

### P2 — Auto Loader (engine-owned bronze)

For file drops. Metadata row sets `source_format: cloudfiles` and
`source_details: { path, file_format }`; the generic engine registers a streaming
table with Auto Loader (`read_files`) and applies `select_columns`. No new code —
the factory loop in `engine/ingest_pipeline.py` already handles it.

### P3 — Pre-landed Delta

Two flavors, both metadata-only:
- **Consume-only** (default): bronze exists (another pipeline/team owns it);
  `target_details.bronze_table` points at it and the engine registers nothing —
  it only builds silver.
- **Engine snapshot**: `source_details.raw_table` set → engine materializes
  bronze as a batch table from the raw table.

### P4 — CDC gateway *(planned, nrt group)*

Databases at change-data-capture scale: Lakeflow Connect **gateway**
(`ingestion_gateway_id`) + ingestion pipeline, continuous; flows join the
`brnz_{source}_nrt` group instead of the batch group. Reserved `source_format:
lakeflow_gateway`; requires engine v2.x (bump `framework_min_version`).

### P5 — Zero-copy federation *(complement — explicitly NOT a bronze pattern)*

Salesforce **Data Cloud** can be mounted as a UC foreign catalog: zero pipelines,
zero storage, always-current — and zero history, zero recon baseline, zero SLA
independence, plus it needs the Data Cloud SKU. Decision (2026-07-12 review):
bronze stays a **governed copy** (P1); federation is welcome later as an ad-hoc
query path, never as the system of record for downstream layers.

---

## 2. Orchestration patterns (workflows)

**One Lakeflow **job** per source** = the only scheduler. Pipelines never
self-schedule; the app never runs on a clock.

```
{source}_workflow
  schedule: quartz cron from the contract's ingestion.batch_schedule (America/New_York)
  task ingest   → pipeline_task: brnz_{source}_ingest      (P1/P4 sources only)
  task etl      → pipeline_task: slvr_{source}_etl          (depends_on: ingest)
  [task recon]  → pf-framework-recon                        (build-time; see below)
```

- **Batch sources** (`snapshot` / `incremental` modes): triggered pipelines +
  cron workflow. **CDC sources**: continuous ingestion, nrt group (P4).
- **Build-time vs scheduled runs**: a factory build runs the workflow *and* the
  recon job and gates the PR on thresholds. Scheduled (cron) runs are pure
  platform — no app, no tokens, no LLM. Recon on schedule is optional: add the
  recon task to the workflow when the source demands continuous parity evidence,
  otherwise recon rides builds.
- **Idempotent provisioning**: the app finds-by-name and creates/updates —
  rerunning a build never duplicates assets. Everything tagged
  `generated_by=pipeline_factory`.
- **Failure conventions**: pipeline failures surface via the workflow run; the
  build executor reads the *latest update's* event log for real errors (older
  updates' failures are noise). Scheduled-run alerting: add `email_notifications`
  to the workflow settings — deliberately left to workspace policy, not factory
  opinion.

---

## 3. Metadata requirements per pattern

`ctl.dataflow_spec` — the columns every pattern shares: `dataflow_id`,
`dataflow_group`, `entity`, `spec_version`, `select_columns`, `crosswalk_keys`,
`column_transforms` (incl. per-column `compare`), `data_quality_expectations`
(expect / expect_or_drop / expect_or_fail), `is_active`, `framework_min_version`.

| Pattern | `source_format` | required `source_details` | bronze registered by engine? |
|---|---|---|---|
| P1 managed | `lakeflow_connect` | `source_object`, `connection`, `mode`, [`cursor_column`] | no — ingestion pipeline lands it |
| P2 files | `cloudfiles` | `path`, `file_format` | yes (streaming table) |
| P3 delta | `delta` | [`raw_table`] — omit for consume-only | only if `raw_table` present |
| P4 gateway | `lakeflow_gateway` | `gateway`, `source_object`, keys | no |

The engine's rule is mechanical: it registers bronze **only when it owns the
landing** (`cloudfiles` with `path`, or `delta` with `raw_table`); everything
else is consume-only. Silver stitch + DQ is identical across all patterns.

---

## 4. Adding a source — the checklist

1. **Contract** (v1.1): identity, ownership, dev+prod connectivity, cron
   `batch_schedule`, tables with PKs. Run **Discover source schema** — never
   hand-type columns; prune with `selected: false`.
2. **Connection** (P1/P4 only, one-time): create/authorize the UC connection;
   put its name in the contract as `uc:<name>`.
3. **Generate → review → approve** (gate 1). The LLM only ever writes the spec.
4. **Build**: renders metadata, MERGEs `dataflow_spec`, provisions the assets,
   runs workflow → DQ → recon, opens the metadata-only PR.
5. **Merge** (gate 2) → customer CI promotes via the repo's bundle root
   (`databricks bundle deploy -t <target>`).
6. From then on the cron owns it. Decommissioning goes through the tombstone
   gate — never delete metadata rows.

---

## 5. NRT patterns — how near-real-time data actually arrives

Batch patterns (P1–P3) poll or get scheduled; NRT flips the model: **the pipeline
runs continuous and the cron workflow disappears for that source** (flows join
the `brnz_{source}_nrt` group). Four sanctioned arrival paths:

| Pattern | Arrival mechanism | Latency | Use when |
|---|---|---|---|
| **P4 CDC gateway** | Lakeflow Connect gateway tails the DB transaction log → continuous ingestion pipeline | minutes | databases (SQL Server GA; Oracle/Postgres preview). Zero code |
| **P6 Bus streaming** *(planned)* | Kafka / Kinesis / Event Hubs consumed by `readStream` in a continuous SDP pipeline (engine `source_format: kafka`) | seconds | events already flow through a bus |
| **P7 Zerobus push** *(planned)* | producers write records straight into Delta via the Zerobus gRPC SDK (schema-validated, ACKed, serverless — GA 2026) | seconds | you control the producer and don't want to operate a bus |
| **P2-continuous** | Auto Loader file-notification mode in a continuous pipeline | ~minute | continuous file drops |

Engine impact is intentionally small: bronze acquisition changes per pattern;
silver stitch, DQ, recon, tombstones and evidence are identical. P6/P7 require an
engine minor version (bump `framework_min_version`).

**Salesforce NRT specifically:** the managed connector is batch-only by design
(cursor polling — no real-time). True SF NRT = Salesforce Change Data Capture /
Platform Events via the Pub/Sub API, landed through **P7** (subscriber →
Zerobus, no bus to run) or **P6** (relay into Kafka). Until a contract demands
sub-batch latency, P1 on the contract cron is the right answer.

---

## 6. Pattern anti-patterns (things this framework refuses)

- Hand-written per-source pipelines or notebooks (that's the drift machine the
  framework exists to kill — see the Codex findings on PRs #1–#4).
- LLM-generated SQL/Python files (constraint #1; specs and deltas only).
- App-side schedulers, token-holding daemons, or "the app runs the daily load"
  (workflows own time).
- Deleting dataflow rows to remove a dataset (SDP drops the managed table —
  ADR-010 tombstones instead).
- Federation as bronze (see P5).
