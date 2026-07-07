# The Pipeline Factory CI/CD Contract (v2)

**This document is the product's public interface.** Pipeline Factory is CI/CD-agnostic: it
never talks to your CI system beyond opening a pull request. Your CI integrates by reading
one file and running two commands.

## What the factory pushes (metadata only — ADR-008)

Every factory build pushes a feature branch named `feat/<entity>-ingestion-v<spec_version>`
containing **declarative metadata, never code**:

```
factory.manifest.yml                    <- the contract file (repo root of the branch)
metadata/<source>/<entity>/
  dataflow.yml                          <- the DataflowSpec (mirrors the ctl.dataflow_spec row)
  EVIDENCE.md                           <- human-readable build evidence (same text as PR body)
resources/<source>.pipeline.yml         <- thin DAB resources: Lakeflow Connect ingestion
                                           pipeline + SDP ETL pipeline (engine glob via
                                           ${var.framework_engine_path}) + scheduled workflow
```

Executable code lives once, versioned, in the
[`databricks-ingestion-framework`](https://github.com/tripsankur/databricks-ingestion-framework)
repo (generic SDP engine + recon job). A source PR carries zero code; the engine executes the
`ctl.dataflow_spec` rows the factory MERGEs (tombstoned, never deleted — ADR-010).

Every file carries `generated_by: pipeline_factory`, `spec_id`, `spec_version` headers.
**Never hand-edit these files** — changes belong in the spec; the factory re-renders.

## factory.manifest.yml (manifest_version: 2)

```yaml
manifest_version: 2
generated_by: pipeline_factory
spec_id: spec-86caa689
spec_version: 14
entity: account
artifact_kind: metadata           # ADR-008 — no generated code
artifacts:
  - path: metadata/sfdc/account/dataflow.yml
    sha256: <checksum>
  - path: resources/sfdc.pipeline.yml
    sha256: <checksum>
spec_table: ctl.dataflow_spec     # rows MERGEd by the factory; tombstoned (ADR-010)
commands:
  verify: make verify
  deploy: databricks bundle deploy -t <target>
evidence:
  location: metadata/sfdc/account/EVIDENCE.md
```

## What your CI must do

1. **On PR**: parse `factory.manifest.yml`; verify each artifact's sha256 matches (tamper
   check); run `commands.verify`.
2. **After merge** (promotion — yours entirely): run `commands.deploy` with your target.
   The repo root's `databricks.yml` includes `resources/*.yml` and defines
   `framework_engine_path` / `spec_table` variables per target, so
   `databricks bundle deploy -t prod` materializes the ingestion pipeline, ETL pipeline and
   scheduled workflow against the prod-deployed framework engine. The factory itself never
   deploys beyond the `dev` target; prod promotion is your CI's job and your approval flow.

That is the whole integration. GitHub Actions reference: `.github/workflows/ci.yml` in this
repo. Azure DevOps / GitLab: implement the same two steps against the same manifest.

## Guarantees

- `manifest_version` bumps on any schema change (v1 → v2: artifacts became metadata-only;
  `artifact_kind` and `spec_table` fields added; evidence moved under `metadata/…`).
- Checksums are SHA-256 over exact file bytes (LF endings, single trailing newline).
- The factory opens PRs but never merges them (human gate #2).
- Decommissioning an entity never happens implicitly: spec rows are tombstoned via an
  explicit human confirmation in the app (ADR-010).
