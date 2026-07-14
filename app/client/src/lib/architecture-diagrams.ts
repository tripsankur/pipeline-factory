/**
 * In-app mirrors of docs/ARCHITECTURE_DIAGRAMS.md (the version-controlled
 * authority). Keep the two in sync when architecture changes — the Docs page
 * renders these with mermaid.
 */

export interface ArchDiagram {
  id: string;
  title: string;
  caption: string;
  code: string;
}

export const ARCH_DIAGRAMS: ArchDiagram[] = [
  {
    id: "l1",
    title: "L1 — System context (C4-1)",
    caption:
      "Happy path: engineer uploads contract → discovery + LLM spec → approve (gate 1) → metadata rendered + assets provisioned → workflow runs → PR with evidence → merge (gate 2) → CI promotes.",
    code: `flowchart LR
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
    DBX -->|silver tables as dbt sources| DBT`,
  },
  {
    id: "l2",
    title: "L2 — App containers (C4-2)",
    caption:
      "Single stateless Fastify process; ResilientStore reads Lakebase Postgres first with per-call warehouse fallback; all Databricks side effects flow through the provisioner and executor.",
    code: `flowchart TB
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
    PG[(Lakebase Postgres\nspecs · versions · builds · llm_calls)]
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
    CTL -->|CDF synced tables| PG`,
  },
  {
    id: "l3-ingestion",
    title: "L3.1 — Ingestion capability (workflow)",
    caption:
      "Every run — build-triggered, cron, or manual — logs ingestion_runs and reconciles under the same workflow run_id, with zero app involvement on schedule. drift_check gates the chain first for describe-capable sources.",
    code: `flowchart LR
    SF[(Salesforce)]
    CONN[UC Connection\none-time OAuth U2M consent]
    subgraph WF[source_workflow - cron from ctl.batch_config]
        direction LR
        T0[drift_check\nlive schema vs contract\npolicy: warn / fail / pass] --> T1[ingest\nbrnz_src_ingest\nLakeflow Connect pipeline]
        T1 --> T2[etl\nslvr_src_etl\nSDP engine over dataflow_spec]
        T2 --> T3[log_run\ncounts → ingestion_runs\nwatermarks upsert]
        T3 --> T4[recon\nsource vs target\nkey / row / attribute rates]
        T4 --> S1[sync_N\nLakebase synced tables]
    end
    BRZ[(bronze.src_entity\nSCD, include_columns from contract)]
    SLV[(silver.entity\nstitch + DQ expectations)]
    IR[(ctl.ingestion_runs)]
    RR[(ctl.recon_*)]
    DR[(ctl.drift_events)]

    SF -->|cursor SystemModstamp| T1 --> BRZ
    CONN -.authorizes.- T1
    T0 --> DR
    BRZ --> T2 --> SLV
    T3 --> IR
    T4 --> RR
    S1 -->|dashboard freshness| PGDASH[(pf_lakebase.recon.*\n→ Reconciliation page)]`,
  },
  {
    id: "l3-build",
    title: "L3.2 — Build & fix loop (sequence)",
    caption:
      "The LLM only ever produces specs and spec deltas — never files. Failures feed evidence back for at most 3 delta iterations before escalating to a human with the full trail.",
    code: `sequenceDiagram
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
    WF->>WF: drift → ingest → etl → log_run → recon → sync
    APP->>CTL: read recon rows by workflow run_id
    alt thresholds met
        APP->>GH: PR with EVIDENCE.md
        DE->>GH: merge (gate 2)
    else failure, iterations left
        APP->>LLM: failure evidence → spec DELTA only
        APP->>APP: re-render, re-MERGE, re-run (≤3)
    else exhausted / unfixable
        APP->>DE: needs_human with full evidence
    end`,
  },
  {
    id: "l3-observability",
    title: "L3.3 — Observability & control plane",
    caption:
      "Control plane (operator-editable config tables) drives workflow settings live; observability plane (machine-written run/watermark/recon/drift tables) feeds the dashboard through CDF-synced Lakebase replicas.",
    code: `flowchart LR
    subgraph CONTROL[Control plane - operator-editable]
        BC[(ctl.batch_config\ncron · enabled · retries · SLA ·\nnotify · drift_policy)]
        JC[(ctl.job_config\ntimeout · concurrency · tags)]
    end
    subgraph OBS[Observability plane - machine-written]
        IR[(ctl.ingestion_runs)]
        WM[(ctl.watermarks)]
        RC[(ctl.recon_runs / entity_result / record_diff)]
        DE[(ctl.drift_events)]
    end
    BUILD[Build seeds INSERT-only] --> BC & JC
    OPSUI[Settings panel / PATCH API] -->|live schedule·pause·notify·drift| BC
    BC & JC -->|read at ensure-time| PROV[Provisioner] --> WFJ[Workflow settings]
    WFJ -->|every run| IR & WM & RC & DE
    IR & RC -->|CDF → TRIGGERED synced tables| LB[(Lakebase recon.*)]
    LB --> DASH[Reconciliation dashboard\nruns · Δrows · rates · SLA flags]`,
  },
  {
    id: "l3-storage",
    title: "L3.4 — Storage architecture (ADR-007)",
    caption:
      "App state lives in Lakebase Postgres (ms reads); Spark-facing truth lives in Delta ctl; synced tables bridge the two read-only. A pg outage degrades to per-call warehouse reads, never an outage.",
    code: `flowchart TB
    subgraph APPSTATE[Lakebase Postgres - operational, ms reads]
        SR[(spec_registry / spec_versions)]
        BR[(build_runs)]
        LC[(llm_calls + exact prompt text)]
    end
    subgraph DATAPLANE[Delta workspace.ctl - Spark-facing truth]
        DS[(dataflow_spec - tombstoned)]
        CFG[(batch_config / job_config)]
        RUNS[(ingestion_runs / watermarks / recon_* / drift_events)]
        SA[(staged_artifacts - audit)]
    end
    SYNC[(pf_lakebase.recon.* synced tables\nread-only replicas)]
    SRV[Fastify server] -->|ResilientStore: pg first,\nwarehouse per-call fallback| APPSTATE
    SRV -->|MERGE/DDL via warehouse| DATAPLANE
    ENGINE[Framework engine + logger + recon + drift] --> DS & RUNS
    RUNS -->|CDF, refreshed by workflow sync tasks| SYNC --> SRV`,
  },
];
