# ADR-002: Heavy operations run as Databricks runner jobs, not in the app

**Status:** Accepted · 2026-07-05

## Context
Databricks Apps containers are small, have a 10 MB source limit, no Spark, no CLI, and
restart freely (the app must stay stateless — constraint #6). Bundle deploys, pipeline
runs, and reconciliation need Spark/CLI horsepower.

## Decision
Three Python **runner jobs** ship in the same Asset Bundle: `deploy_runner` (checkout
branch, `bundle deploy -t dev`), `pipeline_runner` (run pipeline/job, collect results into
`ctl.build_runs`), `recon_runner` (count/key/hash compare into `ctl.recon_*`). The app
triggers them via the Jobs API and polls run state, streaming progress to the UI over SSE.

## Consequences
- The app container needs only `fetch` — no Spark, no Databricks CLI, no Python.
- Runner results land in Delta registry tables; the app reads them back via SQL API.
- The app never holds deploy credentials for anything beyond job triggering.
