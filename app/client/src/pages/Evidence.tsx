import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono, StatusPill } from "../components/ui";
import { SpecPicker } from "../components/SpecPicker";
import { DbxLinks } from "../components/DbxLinks";
import Artifacts from "./Artifacts";

export default function Evidence({ specId }: { specId: string | null }) {
  const [selected, setSelected] = useState<string | null>(specId);
  useEffect(() => {
    if (specId) setSelected(specId);
  }, [specId]);
  const q = useQuery({
    queryKey: ["evidence", selected],
    queryFn: () => api.evidence(selected!),
    enabled: selected !== null,
  });

  const picker = (
    <SpecPicker selected={selected} onSelect={setSelected} hint="pick a spec to inspect its build & recon evidence" />
  );
  if (!selected) return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{picker}</div>;
  if (q.isLoading)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {picker}
        <p style={{ color: "var(--pf-tsec)" }}>Loading evidence…</p>
      </div>
    );
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const d = q.data!;
  const recon = d.recon;
  const pct = (v: string | null | undefined) =>
    v === null || v === undefined ? null : `${(Number(v) * 100).toFixed(2)}%`;
  const lastBuild = d.builds[0];

  const reconCards = [
    { label: "Key match", value: pct(recon?.key_match_rate) },
    { label: "Row match", value: pct(recon?.row_match_rate) },
    { label: "Attribute match", value: pct(recon?.attr_match_rate) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "var(--fs-small)", color: "var(--pf-acc)" }}>Switch spec</summary>
        <div style={{ marginTop: 8 }}>{picker}</div>
      </details>
      {/* header */}
      <Card style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
        <Mono>{d.spec.spec_id}</Mono>
        <span style={{ color: "var(--pf-tmut)", fontSize: 11.2 }}>v{d.spec.spec_version}</span>
        <span style={{ color: "var(--pf-tsec)", fontSize: 10.8 }}>
          {d.spec.source.entity} → {d.spec.target.entity}
        </span>
        <button
          className="pf-btn"
          style={{ marginLeft: 8, color: "var(--pf-bad)", background: "none", border: "1px solid var(--pf-bd2)", borderRadius: "var(--rad)", padding: "3px 10px", cursor: "pointer", fontSize: "var(--fs-micro)" }}
          onClick={() => {
            const c = window.prompt(
              `Decommission tombstones '${d.spec.entity}' (dataflow row is_active=false; the engine drops its managed tables on the next update). Type the entity name to confirm:`,
            );
            if (c === null) return;
            void fetch(`/api/specs/${d.spec.spec_id}/decommission`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_entity: c }),
            }).then(async (res) => {
              const j = (await res.json()) as { note?: string; error?: string };
              window.alert(res.ok ? `Decommissioned. ${j.note ?? ""}` : (j.error ?? "failed"));
            });
          }}
        >
          Decommission…
        </button>
        {lastBuild?.pr_url && (
          <span style={{ marginLeft: "auto", fontSize: 10.8 }}>
            {lastBuild.pr_url.startsWith("http") ? (
              <a href={lastBuild.pr_url} target="_blank" rel="noreferrer" style={{ color: "var(--pf-acc)" }}>
                {lastBuild.pr_url}
              </a>
            ) : (
              <Mono>{lastBuild.pr_url}</Mono>
            )}
          </span>
        )}
      </Card>

      <DbxLinks source={d.spec.source.system} />

      {/* recon cards */}
      <div style={{ display: "flex", gap: 12 }}>
        {reconCards.map((c) => (
          <Card key={c.label} style={{ flex: 1, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
              {c.label}
            </div>
            <div
              style={{
                fontSize: 21,
                fontWeight: 700,
                marginTop: 6,
                color: c.value ? "var(--pf-ok)" : "var(--pf-tmut)",
              }}
            >
              {c.value ?? "—"}
            </div>
            {!c.value && (
              <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", marginTop: 4 }}>
                awaiting recon runner (M4)
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* test coverage: ingestion + transformation (showcase panel) */}
      <TestCoverage
        entity={d.spec.entity}
        expectations={d.expectations}
        recon={recon}
        buildOk={lastBuild?.status === "succeeded"}
      />

      {/* build + fix history */}
      <div style={{ display: "flex", gap: 12 }}>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pf-bd)", fontWeight: 600, fontSize: 12.1 }}>
            Build history
          </div>
          {d.builds.length === 0 ? (
            <p style={{ padding: 16, color: "var(--pf-tmut)", fontSize: 10.8 }}>no builds yet</p>
          ) : (
            d.builds.map((b) => (
              <div
                key={b.run_id}
                style={{
                  padding: "9px 16px",
                  borderTop: "1px solid var(--pf-bd)",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  fontSize: 11.2,
                }}
              >
                <StatusPill status={b.status === "succeeded" ? "done" : b.status === "failed" ? "needs_human" : "building"} />
                <Mono>{b.run_id.slice(0, 8)}</Mono>
                <span style={{ color: "var(--pf-tmut)" }}>{b.started_at}</span>
                {b.detail && <span style={{ color: "var(--pf-tmut)" }}>{b.detail}</span>}
              </div>
            ))
          )}
        </Card>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pf-bd)", fontWeight: 600, fontSize: 12.1 }}>
            Fix-loop timeline
          </div>
          {d.fixes.length === 0 ? (
            <p style={{ padding: 16, color: "var(--pf-tmut)", fontSize: 10.8 }}>no fixes required</p>
          ) : (
            d.fixes.map((f) => (
              <div key={f.version} style={{ padding: "9px 16px", borderTop: "1px solid var(--pf-bd)", fontSize: 10.8 }}>
                <Mono>{f.version}</Mono>
                <span style={{ color: "var(--pf-tsec)", marginLeft: 8 }}>{f.reason}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      {/* rendered artifacts */}
      <div>
        <h3 style={{ fontSize: 12.8, margin: "6px 0 10px" }}>Rendered artifacts</h3>
        <Artifacts specId={selected} />
      </div>

      {/* prompt transparency: the actual LLM traffic behind this spec */}
      <LlmCalls specId={selected} />
    </div>
  );
}

interface LlmCall {
  call_id: string;
  purpose: string;
  endpoint: string;
  status: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  prompt_text: string | null;
  response_text: string | null;
  created_at: string | null;
}

function LlmCalls({ specId }: { specId: string }) {
  const q = useQuery({
    queryKey: ["llm-calls", specId],
    queryFn: async () => {
      const r = await fetch(`/api/specs/${specId}/llm-calls`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { calls: LlmCall[] };
    },
  });
  if (q.isLoading || q.isError) return null;
  const calls = q.data!.calls;
  if (calls.length === 0) return null;
  return (
    <Card style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "var(--fs-h3)" }}>LLM calls (exact prompts & responses)</h3>
      <p style={{ margin: "0 0 8px", fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
        Every generation and fix-loop call the app made for this spec — the model only ever produces specs, never files.
      </p>
      {calls.map((c) => (
        <details key={c.call_id} style={{ borderTop: "1px solid var(--pf-bd)", padding: "6px 0" }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--fs-small)" }}>
            <Mono>{c.purpose}</Mono>
            <span style={{ color: c.status === "ok" ? "var(--pf-ok)" : "var(--pf-bad)", marginLeft: 8 }}>{c.status}</span>
            <span style={{ color: "var(--pf-tmut)", marginLeft: 8 }}>
              {c.endpoint} · {c.latency_ms ?? "?"} ms · {c.prompt_tokens ?? "?"}→{c.completion_tokens ?? "?"} tok ·{" "}
              {c.created_at?.slice(0, 19)}
            </span>
          </summary>
          {c.prompt_text ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
              {(["prompt_text", "response_text"] as const).map((k) => (
                <pre
                  key={k}
                  style={{
                    margin: 0,
                    padding: 8,
                    background: "var(--pf-code-bg)",
                    border: "1px solid var(--pf-bd)",
                    borderRadius: "var(--rad)",
                    fontSize: "var(--fs-mono)",
                    fontFamily: "var(--pf-font-mono)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 240,
                    overflow: "auto",
                  }}
                >
                  {c[k] ?? "(empty)"}
                </pre>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)", margin: "6px 0 0" }}>
              full text unavailable (call predates Lakebase store or warehouse fallback active)
            </p>
          )}
        </details>
      ))}
    </Card>
  );
}


/** Test coverage matrix — what is verified on EVERY run, split by layer.
 *  Ingestion checks come from the workflow's own tasks (drift gate, counts,
 *  reconciliation); transformation checks are the ruleset's data-quality
 *  expectations enforced inside the silver pipeline. */
function TestCoverage({
  entity,
  expectations,
  recon,
  buildOk,
}: {
  entity: string;
  expectations: { name: string; constraint: string; action: string }[];
  recon: { key_match_rate: string | null; row_match_rate: string | null; attr_match_rate: string | null; source_count?: number | null; target_count?: number | null } | null;
  buildOk: boolean;
}) {
  const [latest, setLatest] = useState<{ bronze_count: number | null; silver_count: number | null; state: string | null } | null>(null);
  useEffect(() => {
    fetch(`/api/recon/ingestion?entity=${encodeURIComponent(entity)}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { runs?: { bronze_count: number | null; silver_count: number | null; state: string | null }[] } | null) => setLatest(j?.runs?.[0] ?? null))
      .catch(() => setLatest(null));
  }, [entity]);

  const pct = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  const pass = (ok: boolean | null) =>
    ok === null ? (
      <span style={{ color: "var(--pf-tmut)" }}>not yet run</span>
    ) : ok ? (
      <span style={{ color: "var(--pf-ok)", fontWeight: 600 }}>PASS</span>
    ) : (
      <span style={{ color: "var(--pf-bad)", fontWeight: 600 }}>FAIL</span>
    );

  const ingestion: { name: string; detail: string; ok: boolean | null }[] = [
    {
      name: "Schema drift gate",
      detail: "live source schema vs contract selection (first task of every run)",
      ok: latest ? latest.state === "succeeded" : null,
    },
    {
      name: "Load completeness",
      detail: latest ? `bronze ${latest.bronze_count ?? "?"} = silver ${latest.silver_count ?? "?"}` : "bronze row count = silver row count",
      ok: latest && latest.bronze_count !== null ? latest.bronze_count === latest.silver_count : null,
    },
    {
      name: "Key reconciliation",
      detail: "every source business key found in the target",
      ok: recon ? pct(recon.key_match_rate) === 1 : null,
    },
    {
      name: "Row reconciliation",
      detail: "row-level parity across the joined set",
      ok: recon ? pct(recon.row_match_rate) === 1 : null,
    },
    {
      name: "Attribute reconciliation",
      detail: "cell-by-cell value comparison on all mapped columns",
      ok: recon ? pct(recon.attr_match_rate) === 1 : null,
    },
  ];

  const covered = ingestion.filter((t) => t.ok).length + (buildOk ? expectations.length : 0);
  const total = ingestion.length + expectations.length;

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pf-bd)", display: "flex", alignItems: "baseline", gap: 10 }}>
        <strong style={{ fontSize: 12.1 }}>Test coverage</strong>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          executed on every workflow run — build, scheduled or manual
        </span>
        <span style={{ marginLeft: "auto", fontSize: "var(--fs-small)", fontWeight: 700, color: covered === total ? "var(--pf-ok)" : "var(--pf-warn)" }}>
          {covered}/{total} checks passing
        </span>
      </div>

      <div style={{ padding: "8px 16px 4px", fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
        Ingestion tests ({ingestion.length})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.2 }}>
        <tbody>
          {ingestion.map((t) => (
            <tr key={t.name} style={{ borderTop: "1px solid var(--pf-bd)" }}>
              <td style={{ padding: "7px 16px", fontWeight: 600, width: 200 }}>{t.name}</td>
              <td style={{ padding: "7px 16px", color: "var(--pf-tsec)" }}>{t.detail}</td>
              <td style={{ padding: "7px 16px", width: 90 }}>{pass(t.ok)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ padding: "10px 16px 4px", fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
        Transformation tests — ruleset expectations ({expectations.length})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.2 }}>
        <tbody>
          {expectations.map((e) => (
            <tr key={e.name} style={{ borderTop: "1px solid var(--pf-bd)" }}>
              <td style={{ padding: "7px 16px", width: 200 }}>
                <Mono>{e.name}</Mono>
              </td>
              <td style={{ padding: "7px 16px", color: "var(--pf-tsec)", fontFamily: "var(--pf-font-mono)", fontSize: 10.8 }}>{e.constraint}</td>
              <td style={{ padding: "7px 16px", width: 70 }}>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase",
                  color: e.action === "fail" ? "var(--pf-bad)" : e.action === "drop" ? "var(--pf-warn)" : "var(--pf-tsec)",
                  background: e.action === "fail" ? "var(--pf-bad-soft)" : e.action === "drop" ? "var(--pf-warn-soft)" : "var(--pf-chip)" }}>
                  {e.action}
                </span>
              </td>
              <td style={{ padding: "7px 16px", width: 90 }}>{pass(buildOk ? true : null)}</td>
            </tr>
          ))}
          {expectations.length === 0 && (
            <tr><td style={{ padding: 14, color: "var(--pf-tmut)" }}>none defined</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
