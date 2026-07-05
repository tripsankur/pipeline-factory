# Pipeline Factory

Builds complete ingestion pipelines from natural-language interface contracts. An LLM
(Databricks FMAPI) turns a contract (CSV/DOCX) into a structured mapping **spec**; a human
approves it; a deterministic renderer stamps artifacts (ingestion config, silver stitch SQL,
adapter view, expectations, recon job, tests); the factory opens a PR with evidence.
Promotion beyond the PR belongs to your CI — see `docs/CICD_CONTRACT.md`.

## Hard rules (never break)

1. LLM output is the spec (or a spec delta), never a file — ADR-001.
2. Fix loop edits the spec, re-renders, re-deploys. Max `MAX_FIX_ITERATIONS`, then `needs_human`.
3. The app never deploys to prod. Dev target only.
4. No secrets in code, spec, or git.
5. Every generated asset is tagged (`generated_by`, `spec_id`, `spec_version`).
6. Registry Delta tables (`workspace.ctl.*`) are the single source of truth; app is stateless.
7. Two human gates always: spec approval, PR merge.
8. Adapter pattern at every boundary (`packages/adapters`).

## Local dev

```bash
pnpm install
pnpm exec tsc -b && pnpm --filter @pf/client build
# terminal 1 — server on :8300 against the real workspace
DATABRICKS_HOST=https://<workspace> \
DATABRICKS_TOKEN=$(databricks auth token --profile DEFAULT | jq -r .access_token) \
DATABRICKS_WAREHOUSE_ID=<id> DATABRICKS_APP_PORT=8300 \
PF_DEV_USER_EMAIL=you@example.com \
pnpm --filter @pf/server exec tsx src/index.ts
# terminal 2 — Vite dev client on :5173 (proxies /api)
pnpm --filter @pf/client dev
```

## Test

```bash
pnpm test              # unit + golden files
UPDATE_GOLDEN=1 pnpm test   # regenerate goldens — ONLY with explicit approval (breaking change)
```

## Deploy (dev target only)

```bash
pnpm exec tsc -b && pnpm --filter @pf/client build && node scripts/bundle-app.mjs
databricks bundle deploy -t dev --profile DEFAULT
databricks bundle run pipeline_factory -t dev --profile DEFAULT
```

One-time workspace setup (admin): create the registry schema and grant the app SP —

```sql
CREATE SCHEMA IF NOT EXISTS workspace.ctl;
GRANT USE CATALOG ON CATALOG workspace TO `<app-sp-client-id>`;
GRANT ALL PRIVILEGES ON SCHEMA workspace.ctl TO `<app-sp-client-id>`;
```

## Notes for this workspace

- Claude FMAPI endpoints are rate-limited to 0 (trial); `PF_LLM_ENDPOINT` defaults to
  `databricks-llama-4-maverick`. Swap via env/bundle var when Claude is enabled.
- GitHub adapter targets `databricks-brnz-ingestion`; until a PAT lands in secret scope
  `pipeline_factory` (key `github_token`), the mock CI/CD adapter is active.
