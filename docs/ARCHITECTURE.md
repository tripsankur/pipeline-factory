# Pipeline Factory — Architecture

A Node.js/TypeScript Databricks App that turns natural-language interface contracts into
complete, reviewed, reconciled ingestion pipelines. Product, not one-off tool: CI/CD-agnostic
(ADR-003), transport-pluggable, prompt-driven (ADR-004). The Galileo migration is customer #1.

## The one rule everything hangs on

**The LLM produces specs; the renderer produces files** (ADR-001). LLM-authored SQL lives
*inside* the spec as `transform` values a human approves cell-by-cell. The fix loop edits
the spec and re-renders — it can not touch files (ADR-002/constraint #2).

## Data flow

```
contract (CSV/DOCX)                                   [adapters/contracts]
  → parsed schema preview                             [app UI: Intake]
  → FMAPI structured output → zod-validated Spec      [adapters/llm, packages/core spec.ts]
  → human review + approval  (GATE #1)                [app UI: Mapping]
  → renderer: (spec) -> files[]                       [packages/core renderer.ts + templates/]
  → branch + commit + factory.manifest.yml            [adapters/cicd — GitHub or mock]
  → stage artifacts to ctl.staged_artifacts           [build-executor "deploy_dev"; ADR-006]
  → pf-pipeline-runner job: execute SQL + expectations[runners/pipeline_runner]
  → pf-recon-runner job: count/key/attr compare       [runners/recon_runner → ctl.recon_*]
  → (failure) fix loop: LLM SpecDelta → re-render     [bounded MAX_FIX_ITERATIONS → needs_human]
  → PR with EVIDENCE.md (recon rates, fix timeline)   (GATE #2 — merge is human, always)
  → customer CI verifies manifest checksums           [docs/CICD_CONTRACT.md]
```

Live progress streams to the build console over SSE (`/api/specs/:id/build/stream`).

## State

`{catalog}.ctl` Delta tables are the single source of truth (constraint #6); the app is
stateless and restartable. Tables: `spec_registry`, `spec_versions` (append-only spec JSON),
`build_runs`, `recon_runs`, `recon_entity_result`, `recon_record_diff`, `llm_calls`,
`feature_events` (coming-soon click tracking), `staged_artifacts` (runner input, ADR-006).
Boot migration is idempotent; it also grants the runner principal SELECT+MODIFY on tables
the app SP owns (`PF_RUNNER_PRINCIPAL`).

## Packages

| Path | Role |
|---|---|
| `packages/core` | domain: zod spec + delta, renderer, manifest, evidence, registry DDL, feature flags |
| `packages/dbx` | typed fetch client: SQL Statement Execution, Jobs, Files, Serving; M2M OAuth/PAT |
| `packages/adapters` | boundaries: cicd (github/mock/+stubs), contracts (csv/docx/+stub), transport, llm (FMAPI) |
| `app/server` | Fastify: routes, SSE, identity from forwarded headers, build executor |
| `app/client` | React+Vite per Claude Design tokens (`theme/tokens.css`), dark-first |
| `runners/` | Python serverless jobs (in-bundle): pipeline execution + reconciliation |
| `templates/` | nunjucks artifact templates (golden-file gated) |

## Deploy

One bundle ships everything: `databricks bundle deploy -t dev` (app + 2 runner jobs), then
`bundle run pipeline_factory` to start the app. The deploy artifact is an esbuild single-file
server + built client + templates — no npm install at app startup, ~5 MB. The app refuses
any non-dev target at boot (constraint #3); prod promotion belongs to customer CI post-merge.

## Config (env, never code)

`PF_LLM_ENDPOINT` (FMAPI endpoint name) · `PF_GITHUB_REPO` + `GITHUB_TOKEN` (secret scope
`pipeline_factory`; absent → mock adapter) · `PF_JOB_PIPELINE_RUNNER` / `PF_JOB_RECON_RUNNER`
(injected from bundle job resources; absent → runner steps deferred, never simulated) ·
`MAX_FIX_ITERATIONS` · `PF_RECON_MIN_KEY` / `PF_RECON_MIN_ATTR` (fix-loop thresholds) ·
`PF_RUNNER_PRINCIPAL`.

## Verification

`pnpm test` (unit + golden files — golden diffs are breaking changes) ·
`node scripts/smoke.mjs` (headless full loop against the deployed app, run before demos) ·
reference CI (`.github/workflows/ci.yml`) re-hashes every artifact against the manifest.
