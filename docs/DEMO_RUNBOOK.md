# Pipeline Factory — End-to-End Demo Runbook

**Story in one line:** paste an Interface Contract → the app generates the spec with an
LLM, a human approves, and the factory provisions standard Lakeflow assets, runs them,
tests, reconciles source-to-target, and opens an evidence-backed PR — then keeps running
on schedule with zero app involvement, visible on the dashboard.

**Duration:** ~25 min demo + 10 min Q&A. **Demoed live against:** Salesforce dev org →
Databricks trial workspace → GitHub.

---

## 0. One-time prerequisites (do once, days before)

| # | What | How | Verify |
|---|------|-----|--------|
| 0.1 | Salesforce Connected App | SF Setup → App Manager → Connected App with OAuth scopes `api refresh_token`, callback `https://<app-host>/api/connections/sfdc/callback` | client id/secret in hand |
| 0.2 | SF credentials in secret scope | **In-app wizard**: Settings → Connections → Connect Salesforce → name `sfdc_sample` + Consumer Key/Secret → browser consent (app callback stores all secrets). Fallback: `sf_auth.py` with a `localhost` callback registered | `python scripts/demo/sf_auth.py --check` → "refresh token OK" |
| 0.3 | **Lakeflow Connect UC connection** `sfdc_sample` | Catalog Explorer → External data → Connections → Create → **Salesforce** → name `sfdc_sample` → complete the OAuth consent in the popup (this is the design's one-time human consent gate) | `databricks connections list` shows `sfdc_sample SALESFORCE` |
| 0.4 | Grant connection to app SP | `GRANT USE CONNECTION ON CONNECTION sfdc_sample TO ` `` `38ec922f-43ac-4263-b795-4f3c508b97f8` `` | SQL editor, runs clean |
| 0.5 | Sync-pipeline grants to app SP | For each of the 4 `Synced table: pf_lakebase.recon.*` pipeline ids: `databricks permissions update pipelines <id> --json '{"access_control_list":[{"service_principal_name":"38ec922f-43ac-4263-b795-4f3c508b97f8","permission_level":"CAN_RUN"}]}'` | next build's workflow shows `sync_1..4` tasks |
| 0.6 | Framework bundle deployed | `databricks bundle deploy -t dev` in `databricks-ingestion-framework` | engine 1.2.1+ in workspace files |
| 0.7 | App deployed + healthy | `pnpm bundle:app && databricks bundle deploy -t dev && databricks bundle run pipeline_factory` | `/api/health` → `"store":"postgres"` |

> **If 0.3 is unavailable on the workspace tier** (managed Salesforce connector not
> enabled): the demo still works end-to-end on the P3 path (engine-owned bronze) — skip
> 0.3/0.4, use a contract whose `secret_scope` has no `uc:` prefix, and say: *"managed
> connector is a config flip — same contract, same app flow."* Everything else is identical.

## 1. Pre-demo reset (T-30 minutes)

```bash
cd pipeline-factory

# 1. wipe + reseed Salesforce demo data (namespaced 'PF Demo%', touches nothing else)
python scripts/demo/sf_data.py wipe
python scripts/demo/sf_data.py seed --count 25
python scripts/demo/sf_data.py count          # expect 25

# 2. tear down all factory assets for sfdc (jobs, pipelines, tables, registry rows)
python scripts/demo/demo_reset.py sfdc        # type: reset sfdc

# 3. sanity
curl -s $APP/api/health | jq .status          # ok
```

Open these tabs before starting: **(1)** the app, **(2)** Databricks Workflows list,
**(3)** Databricks Catalog Explorer at `workspace.bronze`, **(4)** GitHub
`databricks-brnz-ingestion` PRs, **(5)** Salesforce Accounts list view filtered `PF Demo`.

Checkpoint: app Fleet page EMPTY, Workflows has no `sfdc_workflow`, `bronze` schema has
no `sfdc_account`, Salesforce shows 25 PF Demo accounts.

**Validated reference numbers (2026-07-14 rehearsal):** build run bronze 38 = silver 38
(25 demo + 13 org built-ins), recon 100/100/100; after `batch --count 5` + manual run:
43 = 43, Δrows +5, recon 100%. Drift: 64 "added" events per run (70 live fields vs 6
selected). Refresh tokens now self-heal (engine ≥1.2.3 writes rotations back).

---

## 2. The demo script

### Act 1 — The problem + the architecture (3 min)

- Open **Docs → Architecture diagrams**. Walk L1: *"contracts in, governed pipelines out;
  the LLM only ever produces metadata — specs — never code. One static engine, N sources."*
- Show L3.1: *"this is what we're about to watch get built: drift gate → ingest → transform
  → self-log → self-reconcile, on a schedule, with zero standing credentials."*
- Talking point: **"the app is a factory, not a runtime — kill the app and tonight's
  ingestion still runs, logs, and reconciles."**

### Act 2 — Interface Contract intake (4 min)

- Intake page → upload `examples/sfdc.contract.yaml`.
- Point at validation: *"contract is the single source of truth — typed columns, PKs,
  cursor, schedule, secret scope by NAME (credentials never appear in a contract)."*
- Click **Discover source schema** → the live org returns ~68 Account fields vs the 6
  declared: *"discovery kills the 'columns someone remembered' bug — prune, don't type."*
- Keep the 6 selected columns. Show the **LLM prompt preview**: *"full transparency —
  this exact prompt, nothing hidden."* → **Generate spec**.

### Act 3 — Human gate 1: review + approve (3 min)

- Mapping page: walk the column mappings, transforms, DQ expectations
  (`annual_revenue IS NULL OR annual_revenue >= 0` — NULL-tolerant, a real fix-loop scar).
- Mention PII: contact columns flagged `pii: true` get UC column tags at build.
- **Approve** — *"gate 1 of 3. Nothing irreversible happens without a human."*

### Act 4 — Build: watch the factory work (7 min) ★ the centerpiece

- Build console → **Build**. Narrate steps as they stream:
  1. `render` — metadata files only (dataflow.yml + resources yml), golden-file-gated
  2. `branch` — metadata-only commit, *"no per-source code exists to drift"*
  3. `spec_upsert` — MERGE to `ctl.dataflow_spec` + INSERT-only config seeds
  4. `provision` — **flip to the Workflows tab**: `sfdc_workflow` appears; Pipelines:
     `brnz_sfdc_ingest` (Lakeflow Connect) + `slvr_sfdc_etl` (SDP). *"Standard Databricks
     primitives — nothing proprietary to operate."*
  5. `workflow_run` — open the run: drift_check → ingest → etl → log_run → recon → sync.
     Flip to Catalog Explorer: `bronze.sfdc_account` materializes with 25 rows.
  6. `dq` + `recon` — *"25 in Salesforce, 25 in bronze, 25 conformed — key/row/attribute
     match rates computed row-by-row, not vibes."*
  7. `pr` — flip to GitHub: metadata-only PR with EVIDENCE.md (counts, rates, DQ results).
- *"Gate 2: a human merges. Gate 3 you'll see later: decommission."*

### Act 5 — Evidence + lineage (2 min)

- Evidence page: recon cards (100/100/100), expectations table, build history,
  **exact LLM prompts + responses** stored per call.
- *"Every table, job, and PR traces to spec_id + contract_id. Ask 'why does this column
  exist' → the answer is one click, not one archaeology sprint."*

### Act 6 — The batch story: scheduled ingestion without the app (4 min) ★ the differentiator

```bash
python scripts/demo/sf_data.py batch --count 5     # 5 new accounts land in SF
```

- Trigger the workflow from **Databricks UI** (Run now) — *"note: not from the app. This
  is what 3 AM looks like."*
- While it runs: Reconciliation dashboard → Ingestion runs panel. When it lands:
  new row, `trigger_type=manual`, bronze 30, **Δrows +5**, recon still 100%.
- *"Same run_id keys the log row, the recon rows, and the drift events. Source-to-target
  recon on EVERY run — build, cron, manual — not just at onboarding."*

### Act 7 — Operations: config, drift, refresh, decommission (3 min)

- Settings → Batch control plane: change cron / SLA / notify → **applies to the live
  job without a rebuild** (show the job's schedule updated in Databricks UI).
- Drift policy dropdown: *"source adds a column tonight → `ctl.drift_events` rows +
  policy warn/fail. Fail means the chain halts BEFORE bad data lands."*
- Full refresh button: typed confirm → watermark reset + full-refresh both pipelines.
- Evidence → **Decommission…**: typed entity name → tombstone (never delete) → *"gate 3.
  The drop-guard makes silent table drops impossible."*

### Close (1 min)

*"One contract file became: a governed ingestion pipeline, a conformance layer, a
scheduled workflow that logs and reconciles itself, PII tags, drift detection, an
auditable PR — and an operations surface. The marginal cost of source #2 is a YAML file."*

---

## 3. Troubleshooting during the demo

| Symptom | Cause | Move |
|---|---|---|
| Build POST times out in UI | app proxy 60 s limit; build continues server-side | say "builds are async" — Build page polls; never re-click Build |
| Build fails, rebuild returns 409 "must be approved" | failed builds set the spec to needs_human | re-approve on Mapping (no edits needed), then Build |
| First ingest takes 10–15 min | first managed-connector sync provisions connector infra | narrate architecture (Act 1 material); later runs take ~2–3 min |
| App 503 "Not Available" | trial apps stop when idle | `databricks bundle run pipeline_factory` (~1 min) — do this in the T-30 check |
| Bronze counts exceed seeded rows | connector ingests ALL org Accounts (built-in samples + PF Demo) | expected; recon still exact — or delete org sample accounts once |
| `connection sfdc_sample missing` in provision | consent gate not done (0.3) | show the message itself — *"designed human gate"* — then fall back to P3 contract |
| Discovery fails `invalid_grant` | SF refresh token expired | `python scripts/demo/sf_auth.py` (browser, 30 s); tokens rotate — always latest in scope |
| Recon/dashboard stale | sync tasks missing (0.5 not done) or quota | trigger sync pipelines manually in Pipelines UI; keep talking |
| `store: warehouse` in /api/health | Lakebase endpoint disabled out-of-band | demo still works (fallback IS a feature — say so); fix per docs/LAKEBASE.md |
| Workflow fails at etl with grants error | SP lost schema grants after reset | `GRANT SELECT, CREATE MATERIALIZED VIEW ON SCHEMA silver TO <SP>` — rerun task |

## 4. Practice loop (repeatable in ~10 min)

```bash
python scripts/demo/demo_reset.py sfdc
python scripts/demo/sf_data.py wipe && python scripts/demo/sf_data.py seed --count 25
# run Acts 2–6, then repeat
```

The reset endpoint is idempotent and scoped: framework bundle, UC connections, secret
scopes, sync pipelines, and the Lakebase project all survive resets.
