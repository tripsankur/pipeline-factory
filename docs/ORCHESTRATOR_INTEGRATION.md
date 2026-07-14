# Orchestrator Integration — external schedulers and Pipeline Factory

**Position (FRAMEWORK_PATTERNS §6):** orchestration lives *inside* Databricks —
Lakeflow Jobs own task graphs, retries, notifications, and schedules
(config-table-driven, ADR-011). No Airflow/ADF is required, and none should
duplicate the task graph.

**The escape hatch:** when an enterprise scheduler must gate ingestion on
upstream events (file delivery, SAP batch close, cross-platform dependencies),
it triggers the *whole workflow* as one opaque unit via `POST /api/2.2/jobs/run-now`
and waits. The task graph, logging, recon, and drift policy remain owned by the
factory — the external tool only decides *when*.

```
External orchestrator ──run-now──▶ {source}_workflow ─▶ drift_check → ingest → etl → log_run → recon → sync
        │                                                                          │
        └────────────── poll runs/get until TERMINATED ◀───────────────────────────┘
```

Every externally triggered run logs to `ctl.ingestion_runs` with
`trigger_type=manual` (pass `external` if you want it distinguishable) and
reconciles — observability is identical to cron runs by design.

---

## 1. Airflow

Use the official `apache-airflow-providers-databricks` provider — do **not**
hand-roll REST calls.

```python
from airflow.providers.databricks.operators.databricks import DatabricksRunNowOperator

trigger_sfdc = DatabricksRunNowOperator(
    task_id="run_sfdc_workflow",
    databricks_conn_id="databricks_sp",          # SP client-id/secret (OAuth M2M)
    job_id=711731692752070,                      # {source}_workflow job id
    job_parameters={"trigger_type": "external"}, # lands in ctl.ingestion_runs
    wait_for_termination=True,                   # operator polls runs/get
    deferrable=True,                             # free the worker slot while waiting
)
```

- **Connection:** service principal OAuth (M2M) in the Airflow connection —
  never a PAT of a human user.
- **Sensor variant:** `DatabricksRunNowDeferrableOperator` /
  `wait_for_termination=True` is the gate; downstream Airflow tasks (e.g. "notify
  finance") depend on it.
- **Failure propagation:** a failed workflow (drift `fail` policy, DQ
  `expect_or_fail`, recon threshold) fails the run → the operator raises →
  Airflow's own retry/alerting takes over. Do not set Airflow retries higher
  than 1 — `ctl.batch_config.max_retries` already retries inside Databricks;
  double retry loops multiply cost.

## 2. Azure Data Factory / Synapse pipelines

ADF has a native **Databricks Job activity** (recommended) or Web activity:

- **Job activity:** linked service = Databricks workspace with managed-identity
  or SP auth → activity type *Job* → pick `{source}_workflow` → pass
  `trigger_type=external` under job parameters. The activity waits for terminal
  state natively.
- **Web activity fallback:** `POST https://<workspace>/api/2.2/jobs/run-now`
  body `{"job_id": ..., "job_parameters": {"trigger_type": "external"}}`,
  then an Until loop on `GET /api/2.2/jobs/runs/get?run_id=...` checking
  `state.life_cycle_state == TERMINATED` and `result_state == SUCCESS`.

## 3. Anything else (cron box, GitHub Actions, ServiceNow)

```bash
databricks jobs run-now --job-id <id> --json '{"job_parameters":{"trigger_type":"external"}}'
```

or raw REST with an SP token. Same contract: one call, one opaque unit, poll
`runs/get`.

---

## Permission matrix

| Principal | Needs | Never |
|---|---|---|
| External orchestrator SP | `CAN_MANAGE_RUN` on `{source}_workflow` jobs (run-now + runs/get only) | workspace admin; CAN_MANAGE (no editing the job it triggers) |
| Factory app SP | owns/edits jobs + pipelines (existing) | — |
| Human operators | app UI; `CAN_VIEW` on jobs for debugging | direct run-now in prod (use the app / orchestrator path so trigger_type is honest) |

Grant per-job, not workspace-wide:

```bash
databricks permissions update jobs <job_id> --json '{
  "access_control_list": [
    {"service_principal_name": "<orchestrator-sp-uuid>", "permission_level": "CAN_MANAGE_RUN"}
  ]}'
```

## Rules that keep this safe

1. **One unit.** External tools trigger the workflow, never individual tasks or
   pipelines — otherwise log_run/recon get skipped and observability lies.
2. **No schedule duplication.** If an external tool owns triggering for a
   source, set `ctl.batch_config.enabled=false` for it (the app pauses the
   Databricks cron) — two schedulers on one workflow = double ingestion cost.
3. **Parameters are the only interface.** `trigger_type` is the sole job
   parameter externals may set. Config (retries, notifications, SLA) stays in
   `ctl.batch_config` — an orchestrator that wants different retries edits
   config via `PATCH /api/config/batches/{source}`, not its own retry loop.
4. **Secrets:** orchestrator credentials live in the orchestrator's secret
   store; Databricks-side credentials stay in secret scopes / UC connections.
   Nothing crosses in plaintext.
