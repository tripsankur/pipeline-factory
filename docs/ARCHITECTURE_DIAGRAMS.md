# Architecture Diagrams — Pipeline Factory (v3)

Principal-architect view of the system, layered C4-style: **L1 system context →
L2 app containers → L3 component diagrams per capability**. Mermaid sources are
authoritative and version-controlled here (rendered by GitHub); the Lucid
document mirrors them for visual editing (links in `docs/design/architecture-v2.md`).

**System overview:** Pipeline Factory turns interface contracts into governed,
reconciled ingestion pipelines. Primary users: data engineers (onboard sources,
approve specs, merge PRs) and operations (schedules, SLAs, recon dashboards).
**Key NFRs:** token-free scheduled execution (no standing credentials), dev-only
app footprint (prod = CI promotion), ms-latency app reads (Lakebase), every
generated asset traceable to its spec and its exact LLM prompt, human gates on
every irreversible step.

---

## L1 — System context (C4-1)

```mermaid
flowchart LR
    DE[Data Engineer / Approver]
    OPS[Operations]
    subgraph PF[Pipeline Factory - Databricks App]
        direction TB
        APP[Contract intake · LLM specs · approval ·\nprovisioning · observability dashboards]
    end
    LLM[FMAPI Serving Endpoint\nLLM - specs and deltas only]
    DBX[Databricks Lakehouse Platform\nUC · Lakeflow Connect · SDP · Jobs · Lakebase]
    SF[(Salesforce\nsource system)]
    GH[GitHub\ningestion-framework repo · brnz-ingestion repo · CI]
    DBT[dbt projects\nsilver → gold marts]

    DE -->|contracts, approvals, PR merges| PF
    OPS -->|schedules, pause, SLA via config tables| PF
    PF -->|contract → spec JSON| LLM
    PF -->|provision ingestion/ETL/workflow, MERGE metadata| DBX
    DBX -->|managed ingestion via UC connection - OAuth U2M| SF
    PF -->|metadata-only PRs + evidence| GH
    GH -->|bundle deploy - framework engine + promoted resources| DBX
    DBX -->|silver tables as dbt sources| DBT
```

**Request flow (happy path):** engineer uploads contract → app validates +
discovers schema → LLM emits spec → engineer approves (gate 1) → renderer emits
metadata → MERGE to `ctl.dataflow_spec` + config seeds → provisioner ensures the
three Lakeflow assets → workflow runs (ingest → etl → log → recon → sync) → PR
with evidence → engineer merges (gate 2) → customer CI promotes.

---

## L2 — App containers (C4-2)

```mermaid
flowchart TB
    subgraph CLIENT[React SPA - DuBois tokens]
        UI[Fleet · Intake · Mapping · Build · Evidence ·\nLineage · Reconciliation · History · Settings · Docs]
    end
    subgraph SERVER[Fastify API - single process, stateless]
        API[REST + SSE routes\nzod-validated]
        EXEC[Build Executor\nfix loop ≤3 spec-deltas]
        PROV[Provisioner\ningestion+ETL+workflow, drop-guard]
        STORE[ResilientStore\nPgStore ⇄ WarehouseStore per-call fallback]
        LLMAD[FMAPI adapter\nstructured outputs + prompt capture]
        CICD[CicdAdapter\nGitHub / ADO / GitLab boundary]
    end
    PG[(Lakebase Postgres\nspecs · versions · builds · llm_calls · contracts)]
    WH[(SQL Warehouse\nDelta DDL + MERGE + fallback reads)]
    CTL[(Delta ctl schema\ndataflow_spec · batch/job_config ·\ningestion_runs · watermarks · recon_*)]
    FM[FMAPI endpoint]
    GHX[GitHub repos]
    LF[Lakeflow assets\nper source]

    UI -->|fetch/SSE| API
    API --> EXEC & PROV & STORE
    EXEC --> LLMAD --> FM
    EXEC --> CICD --> GHX
    STORE --> PG
    STORE -.fallback.-> WH
    EXEC -->|MERGE metadata + config seeds| WH --> CTL
    PROV -->|pipelines + jobs APIs| LF
    CTL -->|CDF synced tables| PG
```

---

## L3.1 — Ingestion capability (workflow v3)

```mermaid
flowchart LR
    SF[(Salesforce)]
    CONN[UC Connection\none-time OAuth U2M consent]
    subgraph WF[source_workflow - cron from ctl.batch_config]
        direction LR
        T1[ingest\nbrnz_src_ingest\nLakeflow Connect pipeline] --> T2[etl\nslvr_src_etl\nSDP engine over dataflow_spec]
        T2 --> T3[log_run\nrun_logger.py\ncounts → ingestion_runs\nwatermarks upsert]
        T3 --> T4[recon\nrecon_job.py\nself-gen recon_id, run_id = job.run_id]
        T4 --> S1[sync_1] --> S2[sync_2] --> S3[sync_3]
    end
    BRZ[(bronze.src_entity\nSCD, include_columns from contract)]
    SLV[(silver.entity\nstitch + DQ expectations)]
    IR[(ctl.ingestion_runs)]
    RR[(ctl.recon_*)]

    SF -->|cursor SystemModstamp| T1 --> BRZ
    CONN -.authorizes.- T1
    BRZ --> T2 --> SLV
    T3 --> IR
    T4 --> RR
    S3 -->|Lakebase synced tables refreshed| PGDASH[(pf_lakebase.recon.*\n→ Reconciliation dashboard)]
```

Every run — build-triggered (`trigger_type=build`), cron (`schedule`), or manual —
produces ingestion_runs + recon rows keyed by the same workflow `run_id`, with
zero app involvement on schedule.

---

## L3.2 — Build & fix loop (sequence)

```mermaid
sequenceDiagram
    actor DE as Data Engineer
    participant APP as App (executor)
    participant LLM as FMAPI
    participant CTL as ctl Delta
    participant WF as source_workflow
    participant GH as GitHub

    DE->>APP: approve spec (gate 1)
    APP->>APP: render METADATA (golden-gated)
    APP->>GH: branch + commit metadata
    APP->>CTL: MERGE dataflow_spec + seed batch/job_config
    APP->>WF: ensure assets (drop-guard) + run (trigger_type=build)
    WF->>WF: ingest → etl → log_run → recon → sync
    APP->>CTL: read recon rows by workflow run_id
    alt thresholds met
        APP->>GH: PR with EVIDENCE.md
        DE->>GH: merge (gate 2)
    else failure, iterations left
        APP->>LLM: failure evidence → spec DELTA only
        APP->>APP: re-render, re-MERGE, re-run (≤3)
    else exhausted / unfixable
        APP->>DE: needs_human with full evidence
    end
```

---

## L3.3 — Observability & control plane

```mermaid
flowchart LR
    subgraph CONTROL[Control plane - operator-editable]
        BC[(ctl.batch_config\ncron · enabled · retries · SLA · notify)]
        JC[(ctl.job_config\ntimeout · concurrency · tags)]
    end
    subgraph OBS[Observability plane - machine-written]
        IR[(ctl.ingestion_runs)]
        WM[(ctl.watermarks)]
        RC[(ctl.recon_runs / entity_result / record_diff)]
    end
    BUILD[Build seeds INSERT-only] --> BC & JC
    OPSUI[Settings panel / PATCH API] -->|live schedule·pause·notify| BC
    BC & JC -->|read at ensure-time| PROV[Provisioner] --> WFJ[Workflow settings]
    WFJ -->|every run| IR & WM & RC
    IR & RC -->|CDF → TRIGGERED synced tables| LB[(Lakebase recon.*)]
    LB --> DASH[Reconciliation dashboard\nruns · Δrows · rates · SLA flags]
```

---

## L3.4 — Storage architecture (ADR-007)

```mermaid
flowchart TB
    subgraph APPSTATE[Lakebase Postgres - operational, ms reads]
        SR[(spec_registry / spec_versions)]
        BR[(build_runs)]
        LC[(llm_calls + exact prompt text)]
        CT[(contracts)]
    end
    subgraph DATAPLANE[Delta workspace.ctl - Spark-facing truth]
        DS[(dataflow_spec - tombstoned)]
        CFG[(batch_config / job_config)]
        RUNS[(ingestion_runs / watermarks / recon_*)]
        SA[(staged_artifacts - audit)]
    end
    SYNC[(pf_lakebase.recon.* synced tables\nread-only replicas)]
    SRV[Fastify server] -->|ResilientStore: pg first,\nwarehouse per-call fallback| APPSTATE
    SRV -->|MERGE/DDL via warehouse| DATAPLANE
    ENGINE[Framework engine + logger + recon] --> DS & RUNS
    RUNS -->|CDF, refreshed by workflow sync tasks| SYNC --> SRV
    APPSTATE -.one-time backfill from warehouse.-> SRV
```

---

## Non-functional annotations

| Concern | Mechanism |
|---|---|
| Availability | app stateless; pg outage → per-call warehouse fallback (`ResilientStore`); scheduled ingestion runs independent of the app entirely |
| Latency | Lakebase reads ≈ 0 ms server-side; dashboard on synced replicas |
| Security | zero standing tokens (workflows self-contained); creds only in secret scopes / UC connections; app SP least-privilege grants |
| Integrity | golden-file renderer gate; manifest sha256 CI gate; tombstoned metadata (no silent drops); `framework_min_version` skew fail-fast |
| Auditability | spec_id on every file/table/job; llm_calls stores exact prompts; ingestion_runs for every execution |
| Quota constraints (trial) | 1 concurrent synced-table refresh → workflow chains sync tasks sequentially |
