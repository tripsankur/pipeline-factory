# Pipeline Factory

A Databricks App that turns interface contracts into complete, reviewed,
reconciled ingestion pipelines — **LLM for specs, metadata for behavior, one
static engine for execution, humans at every gate**.

Live (dev): https://pipeline-factory-7474658437363349.aws.databricksapps.com

## How it works

```
Interface Contract (v1.1, schema-discovered)
      │  FMAPI LLM — structured output, spec JSON only (prompts are user-visible)
      ▼
Mapping spec ── human review + approval (gate 1)
      │  deterministic renderer — METADATA only, golden-file gated
      ▼
metadata/{source}/{entity}/dataflow.yml + resources/{source}.pipeline.yml
      │  MERGE → ctl.dataflow_spec (tombstoned, never deleted)
      ▼
Standard Lakeflow assets (app-provisioned, idempotent):
  brnz_{source}_ingest   Lakeflow Connect ingestion pipeline  (source → bronze)
  slvr_{source}_etl      SDP pipeline running the framework engine (bronze → silver + DQ)
  {source}_workflow      workflow: ingest → etl, cron from the contract
      │  recon: key / row / attribute rates + record diffs
      ▼
Metadata-only PR with EVIDENCE.md ── human merge (gate 2) → customer CI promotes
```

Executable code lives once in
[`databricks-ingestion-framework`](https://github.com/tripsankur/databricks-ingestion-framework)
(semver). Per-source PRs to
[`databricks-brnz-ingestion`](https://github.com/tripsankur/databricks-brnz-ingestion)
carry zero code.

## Monorepo

| path | what |
|---|---|
| `app/server` | Fastify API + SSE build console; store layer (Lakebase pg / warehouse fallback) |
| `app/client` | React SPA, DuBois (Databricks) design tokens |
| `packages/core` | spec + contract zod schemas, renderer, dataflow-spec mapping, registry DDL |
| `packages/adapters` | FMAPI structured-output client + prompts, contract parsers, CicdAdapter (GitHub/mock) |
| `packages/dbx` | thin typed Databricks REST client (SQL, jobs, pipelines, secrets, UC) |
| `templates/` | nunjucks metadata templates (dataflow.yml, source pipeline resources) |
| `tests/golden` | byte-stability gate for rendered metadata |
| `docs/` | ARCHITECTURE, ADR/001–010, LAKEBASE, CONTRACT_FORMAT, CICD_CONTRACT, design/ |

## Develop

```bash
pnpm install
pnpm -r build          # typecheck + build all workspaces
pnpm vitest run        # unit + golden tests
pnpm dev               # local server + client (profile auth)
```

Deploy (dev target only — constraint #3):

```bash
pnpm bundle:app                      # esbuild server + vite client → app/deploy/dist
databricks bundle deploy -t dev
databricks bundle run pipeline_factory
```

One-time workspace setup: `docs/LAKEBASE.md` (postgres project + synced tables),
framework bundle deploy (see the framework repo), grants listed in the in-app
Documentation page.

## The rules that don't move

LLM output is always a spec or a spec-delta, never a file. Files are metadata,
never code. The app never touches prod. Secrets live in scopes/connections.
Everything generated is tagged. Two human gates, plus an explicit decommission
confirmation (tombstones — ADR-010). Full list with amendments:
`docs/ARCHITECTURE.md`.
