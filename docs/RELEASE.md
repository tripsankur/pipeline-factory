# Release contract — what ships, from where, gated by what

Three independently-shipped artifacts make up the product. Nothing else is a
release surface.

| Shippable | Repo | Cadence | Gates |
|---|---|---|---|
| **App bundle** (Databricks App + registry migration) | `pipeline-factory` | on merge to main | `pnpm -r build` + vitest (incl. golden byte-stability) in CI; local artifact boot smoke (`node dist/server.js` + /api/health) before `bundle deploy` |
| **Framework bundle** (engine + recon + logger, semver) | `databricks-ingestion-framework` | semver tags | ruff + pytest in CI; `bundle validate`; MINOR for additive engine features, MAJOR for metadata-schema breaks (must raise `framework_min_version` written by the app) |
| **Metadata PRs** (per source) | `databricks-brnz-ingestion` | per factory build | manifest v2 sha256 verification in CI; human merge (gate 2); promotion = `databricks bundle deploy -t <target>` via the repo's bundle root |

## Versioning rules
- Engine ↔ metadata compatibility: every `dataflow_spec` row carries
  `framework_min_version`; the engine asserts at pipeline init and fails fast on
  skew. Deploy framework upgrades BEFORE app versions that write higher floors.
- Manifest schema changes bump `manifest_version` (public API of the CI/CD
  contract — see `CICD_CONTRACT.md`).
- Registry DDL is idempotent (`CREATE TABLE IF NOT EXISTS`) — additive columns
  only; destructive changes require an explicit migration note here.

## Promotion runbook (prod)
1. Deploy framework bundle to the prod path (`databricks bundle deploy -t prod`
   in the framework repo) — engine files land under `/Workspace/ingestion-framework/prod`.
2. Merge the metadata PR; consuming CI runs
   `databricks bundle deploy -t prod` in `databricks-brnz-ingestion` (bundle root
   maps `framework_engine_path` per target).
3. One-time per source: UC connection consent in the prod workspace; seed/adjust
   `ctl.batch_config` (schedule, notifications, SLA).
4. The app itself never deploys to prod (constraint #3) — it exists only in dev.

## Pre-release checklist (dev)
- [ ] vitest green incl. goldens (renderer byte-stability is the artifact gate)
- [ ] framework pytest green; VERSION == ENGINE_VERSION
- [ ] boot smoke of the bundled server artifact (catches template/probe drift)
- [ ] `databricks bundle validate` both bundles
- [ ] e2e: build a spec → 5-task workflow → ingestion_runs + recon rows keyed by
      the workflow run_id → metadata-only PR → CI checksums pass
