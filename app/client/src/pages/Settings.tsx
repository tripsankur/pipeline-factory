import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Card } from "../components/ui";
import ConnectionsManager from "../components/ConnectionsManager";

interface ConnectionStatus {
  name: string;
  ok: boolean;
  detail: string;
}

export default function Settings() {
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: async (): Promise<{ connections: ConnectionStatus[] }> => {
      const r = await fetch("/api/settings/connections");
      if (!r.ok) throw new Error(`connections check failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const features = useQuery({ queryKey: ["features"], queryFn: api.features });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <ConnectionsManager />
      <BatchConfigPanel />
      <div>
        <h3 style={{ fontSize: 12.8, margin: "0 0 10px" }}>Platform health</h3>
        {connections.isLoading && <p style={{ color: "var(--pf-tsec)" }}>Checking…</p>}
        {connections.isError && <p style={{ color: "var(--pf-bad)" }}>{String(connections.error)}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {connections.data?.connections.map((c) => (
            <Card key={c.name} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: c.ok ? "var(--pf-ok)" : "var(--pf-bad)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, fontSize: 12.1, minWidth: 120 }}>{c.name}</span>
              <span style={{ color: "var(--pf-tsec)", fontSize: 10.8, fontFamily: "var(--pf-font-mono)" }}>
                {c.detail}
              </span>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 12.8, margin: "0 0 10px" }}>Feature flags</h3>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {(features.data?.features ?? []).map((f) => (
            <div
              key={f.id}
              style={{
                padding: "9px 16px",
                borderTop: "1px solid var(--pf-bd)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 10.8,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: f.available ? "var(--pf-ok)" : "var(--pf-bd2)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, minWidth: 190 }}>{f.title}</span>
              <span style={{ color: "var(--pf-tmut)", fontFamily: "var(--pf-font-mono)", fontSize: 10.8 }}>{f.id}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 9.8,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: f.available ? "var(--pf-ok-soft)" : "var(--pf-chip)",
                  color: f.available ? "var(--pf-ok)" : "var(--pf-tmut)",
                }}
              >
                {f.available ? "available" : f.roadmap}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

interface BatchCfg {
  source: string;
  schedule_cron: string | null;
  timezone: string;
  enabled: boolean;
  sla_minutes: number | null;
  notify_emails: string[];
  max_retries: number;
  drift_policy: string;
}

/** Control plane (ADR-011): schedule / pause / SLA / notifications are
 *  config-table-driven — edits apply to the live workflow without a rebuild. */
function BatchConfigPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["batch-config"],
    queryFn: async () => {
      const r = await fetch("/api/config/batches");
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { batches: BatchCfg[] };
    },
  });
  const [drafts, setDrafts] = useState<Record<string, Partial<BatchCfg>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const save = async (source: string) => {
    const d = drafts[source];
    if (!d) return;
    setBusy(source);
    try {
      const r = await fetch(`/api/config/batches/${encodeURIComponent(source)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      const data = (await r.json()) as { applied?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? "patch failed");
      setMsg(`${source}: ${data.applied ?? "saved"}`);
      setDrafts((x) => ({ ...x, [source]: {} }));
      void qc.invalidateQueries({ queryKey: ["batch-config"] });
    } catch (e) {
      setMsg(String(e).slice(0, 180));
    } finally {
      setBusy(null);
    }
  };

  if (q.isError) return null;
  const batches = q.data?.batches ?? [];
  if (batches.length === 0) return null;

  const input = (v: string, on: (s: string) => void, w = 150) => (
    <input
      value={v}
      onChange={(e) => on(e.target.value)}
      style={{ width: w, padding: "4px 8px", borderRadius: "var(--rad)", border: "1px solid var(--pf-bd2)", background: "var(--pf-input-bg)", color: "var(--pf-tpri)", fontFamily: "var(--pf-font-mono)", fontSize: "var(--fs-mono)" }}
    />
  );

  return (
    <div>
      <h3 style={{ fontSize: 12.8, margin: "0 0 4px" }}>Batch control plane</h3>
      <p style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)", margin: "0 0 8px" }}>
        Schedule / pause / SLA / notifications live in <code>ctl.batch_config</code> — edits apply to the
        live workflow without a rebuild (retry policy applies on the next build).
      </p>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
          <thead>
            <tr style={{ color: "var(--pf-tsec)", textAlign: "left" }}>
              {["Source", "Cron (quartz)", "Enabled", "SLA min", "Notify (comma-sep)", "Drift", "", ""].map((h) => (
                <th key={h} style={{ padding: "7px 12px", borderBottom: "1px solid var(--pf-bd)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const d = drafts[b.source] ?? {};
              return (
                <tr key={b.source} className="pf-row">
                  <td style={{ padding: "6px 12px", fontWeight: 600 }}>{b.source}</td>
                  <td style={{ padding: "6px 12px" }}>
                    {input(d.schedule_cron !== undefined ? (d.schedule_cron ?? "") : (b.schedule_cron ?? ""), (v) =>
                      setDrafts((x) => ({ ...x, [b.source]: { ...x[b.source], schedule_cron: v || null } })), 160)}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <input
                      type="checkbox"
                      checked={d.enabled !== undefined ? d.enabled : b.enabled}
                      onChange={(e) => setDrafts((x) => ({ ...x, [b.source]: { ...x[b.source], enabled: e.target.checked } }))}
                    />
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    {input(String(d.sla_minutes !== undefined ? (d.sla_minutes ?? "") : (b.sla_minutes ?? "")), (v) =>
                      setDrafts((x) => ({ ...x, [b.source]: { ...x[b.source], sla_minutes: v ? Number(v) : null } })), 70)}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    {input((d.notify_emails ?? b.notify_emails).join(","), (v) =>
                      setDrafts((x) => ({ ...x, [b.source]: { ...x[b.source], notify_emails: v ? v.split(",").map((s) => s.trim()) : [] } })), 220)}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <select
                      value={(d as { drift_policy?: string }).drift_policy ?? b.drift_policy}
                      onChange={(e) => setDrafts((x) => ({ ...x, [b.source]: { ...x[b.source], drift_policy: e.target.value } as never }))}
                      style={{ padding: "4px 6px", borderRadius: "var(--rad)", border: "1px solid var(--pf-bd2)", background: "var(--pf-input-bg)", color: "var(--pf-tpri)", fontSize: "var(--fs-mono)" }}
                    >
                      {["warn", "fail", "pass"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <button className="pf-btn" onClick={() => void save(b.source)} disabled={busy === b.source || !drafts[b.source] || Object.keys(drafts[b.source] ?? {}).length === 0}>
                      {busy === b.source ? "Saving…" : "Save"}
                    </button>
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <button
                      className="pf-btn"
                      style={{ color: "var(--pf-warn)" }}
                      onClick={() => {
                        const c = window.prompt(`Full refresh resets watermarks and re-ingests EVERYTHING for '${b.source}'. Type the source name to confirm:`);
                        if (c !== b.source) return;
                        setBusy(b.source);
                        void fetch(`/api/ops/full-refresh/${encodeURIComponent(b.source)}`, {
                          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: c }),
                        }).then(async (res) => {
                          const j = (await res.json()) as { note?: string; error?: string };
                          setMsg(res.ok ? `${b.source}: full refresh started — ${j.note ?? ""}` : (j.error ?? "failed"));
                        }).finally(() => setBusy(null));
                      }}
                      disabled={busy === b.source}
                    >
                      Full refresh
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {msg && <div style={{ padding: "6px 12px", fontSize: "var(--fs-micro)", color: "var(--pf-tsec)", borderTop: "1px solid var(--pf-bd)" }}>{msg}</div>}
      </Card>
    </div>
  );
}
