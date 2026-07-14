import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono } from "../components/ui";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card style={{ padding: "18px 22px" }}>
      <h2 id={id} style={{ margin: "0 0 10px", fontSize: 13.2 }}>
        {title}
      </h2>
      <div style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--pf-tsec)" }}>{children}</div>
    </Card>
  );
}

function T({ rows, head }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8, margin: "8px 0" }}>
      <thead>
        <tr style={{ color: "var(--pf-tmut)", textAlign: "left" }}>
          {head.map((h) => (
            <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid var(--pf-bd2)" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--pf-bd)" }}>
            {r.map((c, j) => (
              <td key={j} style={{ padding: "6px 8px", verticalAlign: "top" }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "var(--pf-code-bg)",
        border: "1px solid var(--pf-bd)",
        borderRadius: 8,
        padding: 12,
        fontSize: 10.4,
        fontFamily: "var(--pf-font-mono)",
        overflow: "auto",
        color: "var(--pf-tpri)",
        lineHeight: 1.55,
      }}
    >
      {children}
    </pre>
  );
}

const TOC = [
  ["what", "What is Pipeline Factory"],
  ["quickstart", "Quick start"],
  ["setup", "Workspace setup"],
  ["contract", "Interface Contract format"],
  ["screens", "Screens guide"],
  ["naming", "Ingestion & naming standard"],
  ["build", "Build pipeline & fix loop"],
  ["llm", "How the LLM is prompted"],
  ["architecture", "Architecture (framework + metadata + observability)"],
  ["patterns", "Framework patterns (bronze, NRT, dbt)"],
  ["features", "Features & roadmap"],
  ["trouble", "Troubleshooting"],
] as const;

function LivePrompts() {
  const q = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const r = await fetch("/api/prompts");
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { prompts: { id: string; title: string; content: string }[] };
    },
  });
  if (!q.data) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {q.data.prompts.map((p) => (
        <details key={p.id}>
          <summary style={{ cursor: "pointer", fontSize: "var(--fs-small)", color: "var(--pf-acc)" }}>{p.title}</summary>
          <Code>{p.content}</Code>
        </details>
      ))}
    </div>
  );
}

export default function Docs() {
  const features = useQuery({ queryKey: ["features"], queryFn: api.features });

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <Card style={{ position: "sticky", top: 0, width: 190, flexShrink: 0, padding: 12 }}>
        {TOC.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            style={{ display: "block", padding: "5px 8px", fontSize: 11.2, color: "var(--pf-tsec)", textDecoration: "none", borderRadius: 6 }}
          >
            {label}
          </a>
        ))}
        <a
          href="/api/docs/contract-template"
          style={{ display: "block", margin: "8px 8px 2px", fontSize: 11.2, color: "var(--pf-acc)", textDecoration: "none" }}
        >
          ⬇ Contract template (.yaml)
        </a>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, maxWidth: 860 }}>
        <Section id="what" title="What is Pipeline Factory">
          <p>
            Pipeline Factory turns <strong>interface contracts</strong> into complete, reviewed, reconciled
            ingestion pipelines. An LLM converts the contract into a structured mapping <strong>spec</strong>;
            a human approves it; a deterministic renderer stamps artifacts (ingestion config, silver-stitch SQL,
            adapter view, expectations, recon job, tests); runner jobs execute and reconcile; the factory opens
            a PR with full evidence. Promotion beyond the PR belongs to your CI.
          </p>
          <p style={{ marginBottom: 0 }}>Non-negotiable rules baked into the product:</p>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>The LLM only ever produces the spec (or a spec delta) — files come only from the renderer.</li>
            <li>The fix loop edits the spec and re-renders; it never patches generated files.</li>
            <li>Two human gates, always: spec approval, and PR merge. No auto-merge exists.</li>
            <li>The app never deploys to prod; dev target only.</li>
            <li>No credentials in contracts, specs, code, or git — secret scopes / UC connections only.</li>
            <li>Registry Delta tables (<Mono>workspace.ctl.*</Mono>) are the single source of truth; the app is stateless.</li>
          </ul>
        </Section>

        <Section id="quickstart" title="Quick start — contract to PR in five steps">
          <T
            head={["#", "Step", "Where", "What happens"]}
            rows={[
              ["1", "Connect the source", "Settings → Source connections", "App creates the Unity Catalog connection itself (Salesforce OAuth wizard or generic credentials form)."],
              ["2", "Upload the Interface Contract", "Contract intake", "Drop the .yaml — validated field-by-field; every table of the source appears with prefilled bronze/silver names. Optional: Create ingestion batch (one Lakeflow pipeline pulls all tables → bronze)."],
              ["3", "Generate + review mappings", "Mapping review", "LLM proposes column mappings with confidence + rationale. Edit transform SQL inline, check the acknowledgement, approve (gate #1)."],
              ["4", "Run the build", "Build & test console", "Live stepper: render → branch → stage → pipeline run → expectations → recon. Failures trigger the bounded fix loop (LLM spec-delta, max 3, then needs-human)."],
              ["5", "Merge the PR", "GitHub", "PR carries artifacts + factory.manifest.yml + EVIDENCE.md with recon match rates. Your CI re-verifies checksums. Merge is yours (gate #2)."],
            ]}
          />
        </Section>

        <Section id="setup" title="Workspace setup (one-time, admin)">
          <p>The bundle ships everything: app, runner jobs, registry migration. After first deploy:</p>
          <T
            head={["Requirement", "Command / action"]}
            rows={[
              [<span key="1">Registry schema + app SP access</span>, <Code key="c1">{`CREATE SCHEMA IF NOT EXISTS workspace.ctl;\nGRANT USE CATALOG ON CATALOG workspace TO \`<app-sp-client-id>\`;\nGRANT ALL PRIVILEGES ON SCHEMA workspace.ctl TO \`<app-sp-client-id>\`;`}</Code>],
              [<span key="2">App-managed connections (key feature)</span>, <Code key="c2">{`GRANT CREATE CONNECTION ON METASTORE TO \`<app-sp-client-id>\`;\nGRANT USE SCHEMA, CREATE TABLE ON SCHEMA workspace.bronze TO \`<app-sp-client-id>\`;`}</Code>],
              [<span key="3">GitHub PR flow</span>, <span key="s3">Secret scope <Mono>pipeline_factory</Mono>, key <Mono>github_token</Mono> (fine-grained PAT for the artifacts repo); app resource wires it as <Mono>GITHUB_TOKEN</Mono>. Without it a local mock adapter is used.</span>],
              [<span key="4">Salesforce Connected App (per org, once)</span>, <span key="s4">Salesforce Setup → App Manager → New Connected App → enable OAuth → callback URL from the Settings wizard (Copy button) → scopes <Mono>api refresh_token offline_access</Mono>.</span>],
              [<span key="5">LLM endpoint</span>, <span key="s5"><Mono>PF_LLM_ENDPOINT</Mono> env / bundle var — any FMAPI chat endpoint with structured outputs.</span>],
            ]}
          />
          <p style={{ marginBottom: 0 }}>
            Config reference: <Mono>MAX_FIX_ITERATIONS</Mono> (default 3) · <Mono>PF_RECON_MIN_KEY</Mono>/
            <Mono>PF_RECON_MIN_ATTR</Mono> (default 0.98 — below either triggers the fix loop) ·{" "}
            <Mono>PF_RUNNER_PRINCIPAL</Mono> (identity runner jobs execute as; migration grants it registry access).
          </p>
        </Section>

        <Section id="contract" title="Interface Contract format (v1)">
          <p>
            One contract = <strong>one source system + all tables pulled from it</strong>. Upload as{" "}
            <Mono>.yaml</Mono>/<Mono>.json</Mono> on Contract intake — invalid files are rejected with exact
            field paths. <a href="/api/docs/contract-template" style={{ color: "var(--pf-acc)" }}>Download the template</a>.
            Free-form CSV / DOCX intake also works for single entities, with more LLM guesswork.
          </p>
          <T
            head={["Section", "Mandatory fields", "Notes"]}
            rows={[
              [<Mono key="a">contract</Mono>, "format_version: 1, id, name, version", "bump version on every change"],
              [<Mono key="b">source</Mono>, "system (slug), kind, owner_team, owner_email", "system drives brnz_{system}_batch"],
              [<Mono key="c">connectivity</Mono>, "dev AND prod: host/IP, port, protocol, auth_method, secret_scope", "credentials NEVER in the file — secret scope or uc:<connection> reference only"],
              [<Mono key="d">ingestion</Mono>, "default_mode, batch_schedule (quartz)", "snapshot | incremental | cdc"],
              [<Mono key="e">tables[]</Mono>, "name, primary_key (⊆ columns), columns[] with name + source-native type", "incremental ⇒ cursor_column required; source_object for case-exact native names (e.g. Salesforce 'Account')"],
            ]}
          />
          <p>Minimal valid example:</p>
          <Code>{`contract: { format_version: 1, id: IC-SFDC-001, name: Salesforce core, version: 1 }
source: { system: sfdc, kind: api, owner_team: CRM, owner_email: crm@example.com }
connectivity:
  dev:  { host: login.salesforce.com, port: 443, protocol: https,
          auth_method: oauth_m2m, secret_scope: "uc:sfdc_sample" }
  prod: { host: login.salesforce.com, port: 443, protocol: https,
          auth_method: oauth_m2m, secret_scope: "uc:sfdc_prod" }
ingestion: { default_mode: snapshot, batch_schedule: "0 0 3 * * ?" }
tables:
  - name: account
    source_object: Account
    primary_key: [Id]
    columns:
      - { name: Id,   type: id,     nullable: false }
      - { name: Name, type: string, nullable: false }`}</Code>
          <p style={{ marginBottom: 0 }}>
            Optional per column: <Mono>pii</Mono>, <Mono>enum_values</Mono> (→ value maps), <Mono>sample</Mono>.
            Contract-declared <Mono>mode</Mono>/<Mono>cursor_column</Mono> override LLM guesses; a contract
            fingerprint is stored in each spec's evidence for audit.
          </p>
        </Section>

        <Section id="screens" title="Screens guide">
          <T
            head={["Screen", "Purpose"]}
            rows={[
              ["Fleet dashboard", "Every spec with status, avg mapping confidence, last build, PR. Click a row to open it."],
              ["Contract intake", "Upload contracts (structured yaml or free-form CSV/DOCX); create the source's ingestion batch; generate mappings per table."],
              ["Mapping review", "The core gate: editable transform SQL, confidence badges, rationale drawer, approve bar + modal."],
              ["Build & test", "Live SSE console: 7-step stepper, streaming logs, fix-loop card, PR link."],
              ["PR evidence", "Recon match cards (key/row/attribute), expectations results, build + fix history, rendered artifacts."],
              ["Lineage", "Single source of truth per source: Source → brnz batch → Bronze → Silver stitch → Target, live from the registry."],
              ["Spec history", "Append-only version audit: who changed what, why (approvals, reviewer edits, fix-loop deltas)."],
              ["Settings", "Source connections manager (app-managed), platform health checks, feature flags."],
            ]}
          />
        </Section>

        <Section id="naming" title="Ingestion & naming standard">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>ONE scheduled batch per source system: <Mono>brnz_{"{source}"}_batch</Mono> — all its tables ride together.</li>
            <li>CDC/streaming entities ride the source's near-real-time group: <Mono>brnz_{"{source}"}_nrt</Mono>.</li>
            <li>Flow naming: <Mono>brnz_{"{source}"}_{"{entity}"}_{"{mode}"}</Mono>, e.g. <Mono>brnz_aldm_contract_account_batch</Mono>.</li>
            <li>Bronze tables: <Mono>{"{catalog}"}.bronze.{"{source}"}_{"{table}"}</Mono>; silver targets stitched via the crosswalk join.</li>
            <li>Every generated asset is tagged: <Mono>generated_by</Mono>, <Mono>spec_id</Mono>, <Mono>spec_version</Mono> (headers, TBLPROPERTIES, commits).</li>
          </ul>
        </Section>

        <Section id="build" title="Build pipeline & fix loop">
          <T
            head={["Step", "What it does", "On failure"]}
            rows={[
              ["Render", "Deterministic METADATA files from the approved spec (dataflow.yml + resources yml, golden-file gated)", "—"],
              ["Branch", "feat/{entity}-ingestion-v{n} + commit with spec-tagged message", "—"],
              ["Metadata", "MERGE the DataflowSpec row into ctl.dataflow_spec (tombstone-safe, never deletes)", "—"],
              ["Provision", "Ensure the three standard Lakeflow assets: ingestion pipeline, ETL pipeline, workflow (idempotent, drop-guarded)", "connection gate → needs_human"],
              ["Workflow", "Runs the workflow: pipeline_task(ingest) → pipeline_task(etl) against the framework engine", "fix loop"],
              ["Data quality", "Expectation metrics read from the ETL pipeline's event log", "fix loop"],
              ["Recon", "Framework recon job: count / key / attribute compare vs thresholds; writes ctl.recon_*", "fix loop"],
              ["PR", "Evidence (recon rates, fix timeline) into metadata/{source}/{entity}/EVIDENCE.md + PR body", "—"],
            ]}
          />
          <p style={{ marginBottom: 0 }}>
            <strong>Fix loop:</strong> on failure the LLM receives the real task error and produces a{" "}
            <em>spec delta</em> (never file edits). The spec re-renders, re-upserts, re-runs — bounded by{" "}
            <Mono>MAX_FIX_ITERATIONS</Mono>; exhaustion or an LLM-judged-unfixable failure sets the spec to{" "}
            <Mono>needs_human</Mono>. Every delta is a registry version, visible in Spec history and the PR's
            fix timeline.
          </p>
        </Section>

        <Section id="llm" title="How the LLM is prompted">
          <p>
            The model's role is deliberately narrow: it turns contracts into <em>specs</em> and failures into{" "}
            <em>spec deltas</em> — it never writes files, SQL scripts, or pipelines. The exact prompts are
            user-visible in three places:
          </p>
          <T
            head={["Where", "What you see"]}
            rows={[
              ["Contract intake", "“What the LLM will be asked” — the live system prompt + the composed user prompt for your parsed contract, before you generate"],
              ["PR evidence", "Every actual call for a spec (generation + fix loop): exact prompt, exact response, tokens, latency"],
              ["This page", "The live system prompts below, rendered from the code the server is running right now"],
            ]}
          />
          <LivePrompts />
        </Section>

        <Section id="architecture" title="Architecture — framework, metadata, observability (ADR-008/009/011)">
          <p>
            <strong>One static engine, N sources.</strong> Executable code lives once in{" "}
            <Mono>databricks-ingestion-framework</Mono> (generic SDP engine + recon job, semver-versioned).
            Each source contributes only <em>metadata</em>: a row in <Mono>ctl.dataflow_spec</Mono> and a
            metadata-only PR (<Mono>metadata/{"{source}"}/{"{entity}"}/dataflow.yml</Mono> + a thin{" "}
            <Mono>resources/{"{source}"}.pipeline.yml</Mono>).
          </p>
          <T
            head={["Asset (per source)", "Kind", "Purpose"]}
            rows={[
              [<Mono key="1">brnz_{"{source}"}_ingest</Mono>, "Lakeflow Connect ingestion pipeline", "source → bronze (managed cursoring, SCD, include_columns from the contract)"],
              [<Mono key="2">slvr_{"{source}"}_etl</Mono>, "Lakeflow Declarative Pipeline (SDP)", "bronze → silver stitch + data-quality expectations, driven by dataflow_spec metadata"],
              [<Mono key="3">{"{source}"}_workflow</Mono>, "Lakeflow Job (workflow)", "orchestration: ingest → etl on the contract's cron schedule"],
            ]}
          />
          <p style={{ marginBottom: 0 }}>
            Spec rows are <strong>tombstoned, never deleted</strong> (ADR-010): SDP drops managed datasets
            that vanish from its graph, so decommissioning requires an explicit human confirmation. App
            state lives in Lakebase Postgres; recon results sync back as read-only tables for the
            Reconciliation dashboard (ADR-007).
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Observability &amp; control plane (ADR-011):</strong> every workflow run — build, cron,
            or manual — writes <Mono>ctl.ingestion_runs</Mono> (bronze/silver counts) and reconciles,
            keyed by the workflow run id; observed watermarks land in <Mono>ctl.watermarks</Mono>.
            Operational knobs (schedule, pause, retries, SLA, notifications) live in{" "}
            <Mono>ctl.batch_config</Mono> / <Mono>ctl.job_config</Mono> — seeded by builds, edited in
            Settings → Batch control plane, applied to the live workflow without a rebuild. Decommission
            = tombstone with explicit confirmation; metadata rows are never deleted.
          </p>
        </Section>

        <Section id="patterns" title="Framework patterns — the defined shapes for ingestion">
          <p>
            Every source maps to exactly <strong>one bronze pattern</strong>; orchestration, lifecycle and
            evidence are identical across all of them. New source = pick the row, fill the metadata.
            Full catalog: <Mono>docs/FRAMEWORK_PATTERNS.md</Mono> in the repo.
          </p>
          <T
            head={["Pattern", "Source type", "Bronze owner", "Latency"]}
            rows={[
              ["P1 Managed ingestion (Lakeflow Connect) — Salesforce uses this", "SaaS with a managed connector", "ingestion pipeline (cursoring, SCD, schema evolution — zero code)", "batch"],
              ["P2 Auto Loader", "file drops in cloud storage / volumes", "framework engine (streaming table)", "batch or ~minute (continuous)"],
              ["P3 Pre-landed Delta", "data another team already lands", "consume-only (or engine snapshot)", "batch"],
              ["P4 CDC gateway (planned)", "databases (SQL Server GA; Oracle/Postgres preview)", "gateway + continuous ingestion pipeline", "minutes"],
              ["P6 Bus streaming (planned)", "Kafka / Kinesis / Event Hubs", "engine, continuous pipeline", "seconds"],
              ["P7 Zerobus push (planned)", "apps you control — gRPC straight into Delta, no bus", "producer + Zerobus", "seconds"],
              ["P5 Zero-copy federation", "Salesforce Data Cloud orgs", "none — foreign catalog; complement, NEVER bronze", "query-time"],
            ]}
          />
          <p>
            <strong>Orchestration:</strong> one Lakeflow workflow per source is the only scheduler —
            cron from the contract&apos;s <Mono>batch_schedule</Mono>, tasks{" "}
            <Mono>ingest → etl</Mono> (+ optional recon). NRT sources flip the model: the pipeline runs
            continuous and the cron disappears. <strong>No external orchestrator</strong> (Airflow etc.) —
            everything orchestrated is Databricks work and the schedule ships inside the promoted bundle;
            if an enterprise ever mandates one, it triggers the workflow (run-now) and nothing generated changes.
          </p>
          <T
            head={["Generated artifact (per build)", "Standard enforced"]}
            rows={[
              [<Mono key="a1">metadata/{"{source}"}/{"{entity}"}/dataflow.yml</Mono>, "spec-tagged header; byte-stable; golden-file tested"],
              [<Mono key="a2">resources/{"{source}"}.pipeline.yml</Mono>, "thin DAB — ingestion + ETL + cron workflow; engine path stays a variable for any target"],
              [<Mono key="a3">factory.manifest.yml</Mono>, "manifest v2, sha256 per artifact — CI re-verifies (tamper gate)"],
              [<Mono key="a4">metadata/…/EVIDENCE.md</Mono>, "mapping + confidences + recon rates + fix timeline (same text as PR body)"],
            ]}
          />
          <p style={{ marginBottom: 0 }}>
            <strong>Where dbt fits</strong>{" "}
            <button
              className="pf-btn"
              style={{ background: "none", border: "none", color: "var(--pf-acc)", cursor: "pointer", fontSize: "var(--fs-micro)", padding: 0 }}
              onClick={() => api.featureClick("dbt_integration")}
            >
              (interested? register demand)
            </button>
            : the factory ends at silver; dbt begins there. dbt projects
            declare factory silver tables as <Mono>sources:</Mono> and build gold marts, running as a
            native <Mono>dbt_task</Mono> in the same workflow. dbt never replaces the engine — dbt models
            are code, and per-source artifacts here are metadata by decision (ADR-008).
          </p>
        </Section>

        <Section id="features" title="Features & roadmap">
          <T
            head={["Feature", "Status"]}
            rows={(features.data?.features ?? []).map((f) => [
              <span key={f.id}>
                <strong style={{ color: "var(--pf-tpri)" }}>{f.title}</strong>
                {f.promise ? <span style={{ color: "var(--pf-tmut)" }}> — {f.promise}</span> : null}
              </span>,
              f.available ? (
                <span key="s" style={{ color: "var(--pf-ok)", fontWeight: 600 }}>available</span>
              ) : (
                <span key="s" style={{ color: "var(--pf-tmut)" }}>coming soon · {f.roadmap}</span>
              ),
            ])}
          />
        </Section>

        <Section id="trouble" title="Troubleshooting">
          <T
            head={["Symptom", "Cause", "Fix"]}
            rows={[
              ["502 on the app URL", "app restarting after a deploy", "wait ~30s; health returns at /api/health"],
              ["registry check red in Settings", "ctl schema missing or SP lacks grants", "run the one-time setup SQL (see Workspace setup)"],
              ["Connection create fails: PERMISSION_DENIED", "app SP lacks CREATE CONNECTION", "run the metastore grant (Workspace setup §2)"],
              ["Build stuck needs_human", "fix loop exhausted or LLM judged unfixable", "open Mapping review, fix the spec manually, re-approve, rebuild"],
              ["PR is mock:// not GitHub", "GITHUB_TOKEN / PF_GITHUB_REPO not configured", "add the secret scope + redeploy"],
              ["Contract upload rejected", "format violation", "error lists exact field paths; compare with the downloadable template"],
              ["LLM 403 / rate limit 0", "endpoint disabled in workspace", "switch PF_LLM_ENDPOINT to an enabled FMAPI endpoint"],
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
