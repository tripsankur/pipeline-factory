# Pipeline Factory — Design Document

> Living design doc. Update this file when architecture, pages, or connector
> behavior changes — it is the entry point; deep detail lives in `docs/` and is
> linked per section.

A Databricks App that turns interface contracts into complete, reviewed,
reconciled ingestion pipelines — **LLM for specs, metadata for behavior, one
static engine for execution, humans at every gate**.

Live (dev): https://pipeline-factory-7474658437363349.aws.databricksapps.com

---

## 1. System at a glance

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
  {source}_workflow      drift_check → ingest → etl → log_run → recon → sync_N
      │  every run logs ctl.ingestion_runs + reconciles (key/row/attribute rates)
      ▼
Metadata-only PR with EVIDENCE.md ── human merge (gate 2) → customer CI promotes
```

Executable code lives once in
[`databricks-ingestion-framework`](https://github.com/tripsankur/databricks-ingestion-framework)
(semver; engine 1.2.x). Per-source PRs to
[`databricks-brnz-ingestion`](https://github.com/tripsankur/databricks-brnz-ingestion)
carry zero code. Architecture diagrams (C4 L1→L3): in-app **Docs → Architecture
diagrams**, sources in [`docs/ARCHITECTURE_DIAGRAMS.md`](docs/ARCHITECTURE_DIAGRAMS.md).

## 2. Pages (what each screen is for)

| Page | Purpose | Key actions |
|---|---|---|
| **Fleet** | every spec + status at a glance | jump into any spec |
| **Contract intake** | upload/validate Interface Contract; **Discover source schema** pulls the live field list (e.g. 68 SF Account fields); prune columns; see the exact LLM prompt | Generate spec |
| **Mapping** | column mappings, transforms, DQ expectations, PII flags — human gate 1 | edit, Approve |
| **Build console** | streamed build steps: render → branch → spec_upsert → provision → workflow_run → dq → recon → PII tags → PR; bounded fix loop (≤3 spec-deltas) | Build, watch |
| **Evidence** | recon rates, expectations, build + fix history, rendered artifacts, **exact LLM prompts/responses**, Decommission (gate 3) | audit, decommission |
| **Reconciliation** | fleet KPIs, per-entity parity trends, **Ingestion runs** (every run: trigger type, bronze/silver counts, Δrows, SLA breach), record-diff drill | monitor |
| **Settings** | batch control plane: cron, enabled, SLA, notify, **drift policy**, retries → applied to live jobs without rebuild; **Full refresh**; connection status | operate |
| **History** | spec versions + fix-loop deltas | trace |
| **Docs** | full in-app documentation incl. rendered architecture diagrams, patterns, prompts | reference |

## 3. Data + control tables

| Table (Delta `workspace.ctl`) | Written by | Purpose |
|---|---|---|
| `dataflow_spec` | build MERGE | THE per-entity metadata the engine executes; tombstoned, never deleted (ADR-010) |
| `batch_config` / `job_config` | build seeds (INSERT-only), operators edit | control plane: cron/enabled/retries/SLA/notify/drift_policy; timeout/concurrency/tags (ADR-011) |
| `ingestion_runs` | `run_logger.py` every run | run log: trigger type, bronze/silver counts, state |
| `watermarks` | `run_logger.py` | observed incremental cursors (audit/replay) |
| `recon_runs` / `recon_entity_result` / `recon_record_diff` | `recon_job.py` every run | source↔target parity evidence |
| `drift_events` | `drift_check.py` | schema drift: missing/added columns vs contract |
| registry tables (`spec_registry`, `spec_versions`, `build_runs`, `llm_calls`, …) | app | app state — authoritative copy in **Lakebase Postgres** (ms reads), warehouse fallback (ADR-007) |

Dashboard reads Lakebase synced tables `pf_lakebase.recon.*` (CDF, TRIGGERED,
refreshed by the workflow's `sync_N` tasks).

---

## 4. Salesforce connectivity — the full detail

Two deliberate, separate paths. **Managed connector moves data; REST describes
it.** Credentials never leave the secret scope / UC connection.

### 4.1 Path A — Lakeflow Connect managed connector (P1: the ingestion path)

The pipeline `brnz_sfdc_ingest` is a Lakeflow Connect **ingestion pipeline**:

```yaml
ingestion_definition:
  connection_name: sfdc_sample          # UC Connection (type SALESFORCE)
  objects:
    - table:
        source_schema: objects
        source_table: Account            # SF sObject API name
        destination_catalog: workspace
        destination_schema: bronze
        destination_table: sfdc_account
        table_configuration:
          scd_type: SCD_TYPE_1           # SCD_TYPE_2 when contract demands history
          primary_keys: [Id]
          include_columns: [...]         # EXACTLY the contract's selected columns
```

- **Auth = UC Connection, OAuth user-to-machine (U2M) only.** Consent happens
  ONCE in Catalog Explorer (Create connection → Salesforce → sign in). There is
  deliberately no headless path — this is the design's one-time human consent
  gate. The contract references it as `secret_scope: "uc:<connection-name>"`;
  the build fails with instructions if the connection is missing.
  The app SP needs `GRANT USE CONNECTION ON CONNECTION <name> TO <sp>`.
- **Cursoring is connector-owned**: incremental sync on
  `SystemModstamp → LastModifiedDate → CreatedDate` (first available). No
  watermark code on our side; `ctl.watermarks` records *observed* high-water
  marks for audit only.
- **What the connector handles**: initial + incremental loads, soft deletes
  (`IsDeleted`), additive schema evolution, SCD 1/2, API-call budgeting.
- **Known limits** (design around, don't fight):
  - hard deletes require a **full refresh** (Settings → Full refresh button)
  - formula fields sync with snapshot semantics (value as-of sync time)
  - ~250 objects per pipeline soft limit (one source = one pipeline; fine)
  - not real-time — minimum practical cadence ≈ minutes (NRT = P4/P6 patterns)
  - no row filtering — column selection only (`include_columns`)
- **What the factory automates**: pipeline creation/update from the contract
  (objects, PKs, SCD, include_columns), workflow wiring, drift gating BEFORE
  ingest, per-run logging + recon AFTER etl.

### 4.2 Path B — REST API via Connected App (describe-only: discovery + drift)

Never ingests. Powers `POST /api/connections/{name}/discover` (Intake page) and
the workflow's `drift_check` task. OAuth **refresh-token** flow against a
Connected App in the org:

- **Connected App requirements**: OAuth enabled; scopes **`api`** ("Manage user
  data via APIs") + **`refresh_token, offline_access`** ("Perform requests at
  any time"); callback URL matching what `sf_auth.py` sends (default
  `http://localhost:8787/callback`).
- **Secret-scope layout** (scope `pipeline_factory`, conn name `sfdc_sample`):

  | key | value |
  |---|---|
  | `sfdc_sfdc_sample_client_id` | Connected App consumer key |
  | `sfdc_sfdc_sample_client_secret` | consumer secret |
  | `sfdc_sfdc_sample_refresh_token` | long-lived refresh token (rotated!) |
  | `sfdc_sfdc_sample_instance_url` | e.g. `https://<org>.my.salesforce.com` |
  | `sfdc_sfdc_sample_login_host` | `login.salesforce.com` (or test.) |

- **Token rotation**: orgs may rotate the refresh token on every grant. Both
  the app (`sfdc-describe.ts`) and the scripts write the rotated token back to
  the scope immediately — miss it once and the next grant dies `invalid_grant`.
- **Calls used**: `POST /services/oauth2/token` (refresh grant) →
  `GET /services/data/v60.0/sobjects/{obj}/describe` (field list). That's all.
- **Consumers**: Intake discovery (68-field truth), `drift_check.py`
  (live fields vs contract selection → `ctl.drift_events`, policy
  warn|fail|pass from `batch_config.drift_policy`). Both degrade gracefully
  (warning, not failure) when creds are absent/expired.

### 4.3 Demo/ops tooling for Path B (`scripts/demo/`)

| script | what |
|---|---|
| `sf_auth.py` | browser OAuth flow → refresh token into the scope. `--check` verifies. `--paste` mode works with ANY already-configured callback (no local server — paste the redirected URL back). |
| `sf_data.py` | `seed/batch/count/wipe` namespaced **"PF Demo"** Accounts (composite tree API) — drives the Δrows story between runs |
| `demo_reset.py` | app-side teardown (`/api/ops/demo-reset/{source}` or `all`) |

**Troubleshooting**

| Error | Meaning | Fix |
|---|---|---|
| `redirect_uri_mismatch` | Connected App's Callback URLs don't include the one sf_auth sends | add `http://localhost:8787/callback` in SF Setup → App Manager → Edit (waits ~10 min), OR `python sf_auth.py --paste --callback <a-configured-url>` |
| `invalid_grant: expired access/refresh token` | refresh token expired/revoked (or a rotation write-back was missed) | rerun `sf_auth.py` (fresh consent) |
| `invalid_client_id` / `invalid_client` | consumer key/secret wrong or app not yet propagated | re-copy from the Connected App; new apps take ~10 min to activate |
| discover 502 with token error | same as invalid_grant, surfaced through the app | `sf_auth.py`, then retry Discover |
| `connection sfdc_sample missing` at provision | UC connection (Path A) not created/consented | Catalog Explorer → Create connection → Salesforce → name it exactly as the contract's `uc:` value |

### 4.4 Why not federation / zero-ETL for bronze

Salesforce Data Cloud can mount as a UC foreign catalog (zero pipelines,
always-current) — and zero history, zero recon baseline, zero SLA independence,
plus the Data Cloud SKU. Decision (2026-07-12): bronze stays a **governed copy**
(P1); federation is welcome later as an ad-hoc query path, never the system of
record. Full pattern catalog: [`docs/FRAMEWORK_PATTERNS.md`](docs/FRAMEWORK_PATTERNS.md).

---

## 5. Monorepo

| path | what |
|---|---|
| `app/server` | Fastify API + SSE build console; store layer (Lakebase pg / warehouse fallback) |
| `app/client` | React SPA, DuBois (Databricks) design tokens |
| `packages/core` | spec + contract zod schemas, renderer, dataflow-spec mapping, registry DDL |
| `packages/adapters` | FMAPI structured-output client + prompts, contract parsers, CicdAdapter (GitHub/mock) |
| `packages/dbx` | thin typed Databricks REST client (SQL, jobs, pipelines, secrets, UC) |
| `templates/` | nunjucks metadata templates (dataflow.yml, source pipeline resources) |
| `scripts/demo/` | demo tooling: SF auth/data, factory reset |
| `tests/golden` | byte-stability gate for rendered metadata |
| `docs/` | deep docs — see index below |

## 6. Docs index

| doc | covers |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | system shape + non-negotiable rules |
| [`ARCHITECTURE_DIAGRAMS.md`](docs/ARCHITECTURE_DIAGRAMS.md) | C4 L1/L2/L3 Mermaid (rendered in-app on Docs) |
| [`FRAMEWORK_PATTERNS.md`](docs/FRAMEWORK_PATTERNS.md) | P1–P7 bronze patterns, orchestration, NRT, dbt, audited roadmap |
| [`CONTRACT_FORMAT.md`](docs/CONTRACT_FORMAT.md) | Interface Contract v1/v1.1 + discovery |
| [`CICD_CONTRACT.md`](docs/CICD_CONTRACT.md) | manifest v2, promotion |
| [`ORCHESTRATOR_INTEGRATION.md`](docs/ORCHESTRATOR_INTEGRATION.md) | Airflow/ADF run-now + permission matrix |
| [`DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) | end-to-end demo: prereqs, reset, 7-act script, troubleshooting |
| [`LAKEBASE.md`](docs/LAKEBASE.md) | postgres project, synced tables, endpoint-disabled runbook |
| [`RELEASE.md`](docs/RELEASE.md) | the three shippables + gates |
| `docs/ADR/001–011` | decisions with context (007 Lakebase · 008 framework/metadata · 009 Lakeflow primitives · 010 tombstones · 011 observability + control plane) |

## 7. Develop & deploy

```bash
pnpm install
pnpm -r build          # typecheck + build all workspaces
pnpm vitest run        # unit + golden tests

pnpm bundle:app                      # esbuild server + vite client → app/deploy/dist
databricks bundle deploy -t dev      # dev target only — constraint #3
databricks bundle run pipeline_factory
```

One-time workspace setup: [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) §0
(SF auth, UC connection, grants) + [`docs/LAKEBASE.md`](docs/LAKEBASE.md).

## 8. The rules that don't move

LLM output is always a spec or a spec-delta, never a file. Files are metadata,
never code. The app never touches prod. Secrets live in scopes/connections.
Everything generated is tagged. Two human gates, plus an explicit decommission
confirmation (tombstones — ADR-010). Full list with amendments:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
