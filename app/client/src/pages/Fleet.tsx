import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { IngestionRun } from "../api";
import { api } from "../api";
import { Card, Mono, StatusPill } from "../components/ui";

function confColor(v: number | null): string {
  if (v === null) return "var(--pf-tmut)";
  if (v >= 0.9) return "var(--pf-ok)";
  if (v >= 0.75) return "var(--pf-warn)";
  return "var(--pf-bad)";
}

function ago(ts: string | null): string {
  if (!ts) return "—";
  const then = new Date(ts.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(then)) return ts;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function Fleet({ onOpenSpec }: { onOpenSpec: (specId: string) => void }) {
  const q = useQuery({ queryKey: ["fleet"], queryFn: api.fleet, refetchInterval: 30_000 });

  if (q.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Loading overview…</p>;
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const { specs, kpis } = q.data!;
  const kpiDefs = [
    { label: "Entities mapped", value: kpis.total, of: null as number | null, color: "var(--pf-acc)" },
    { label: "Approved+", value: kpis.approved, of: kpis.total, color: "var(--pf-ok)" },
    { label: "PRs open", value: kpis.pr_open, of: kpis.total, color: "var(--pf-run)" },
    { label: "Needs human", value: kpis.needs_human, of: kpis.total, color: "var(--pf-bad)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <HomeHero total={kpis.total} needsHuman={kpis.needs_human} />
      <div style={{ display: "flex", gap: 12 }}>
        {kpiDefs.map((k) => {
          const pctNum = k.of ? Math.round((k.value / Math.max(1, k.of)) * 100) : null;
          return (
            <Card key={k.label} style={{ flex: 1, padding: "14px 18px" }}>
              <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
                {k.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{k.value}</span>
                {k.of !== null && <span style={{ fontSize: 11.2, color: "var(--pf-tmut)" }}>/ {k.of}</span>}
                {pctNum !== null && (
                  <span style={{ marginLeft: "auto", fontSize: 11.2, fontWeight: 600, color: k.color }}>{pctNum}%</span>
                )}
              </div>
              <div style={{ height: 4, borderRadius: 4, background: "var(--pf-track)", marginTop: 10, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pctNum ?? (k.value > 0 ? 100 : 0)}%`,
                    borderRadius: 4,
                    background: k.color,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {specs.length === 0 ? (
          <p style={{ padding: 24, color: "var(--pf-tsec)" }}>No pipelines yet — open the Pipeline builder and drop in an interface contract.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8 }}>
            <thead>
              <tr style={{ color: "var(--pf-tmut)", textAlign: "left", background: "var(--pf-surf2)" }}>
                <th style={{ padding: "10px 16px" }}>Entity</th>
                <th style={{ padding: "10px 16px" }}>Status</th>
                <th style={{ padding: "10px 16px" }}>Confidence</th>
                <th style={{ padding: "10px 16px" }}>Last build</th>
                <th style={{ padding: "10px 16px" }}>Approved by</th>
                <th style={{ padding: "10px 16px" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((r) => (
                <tr
                  key={r.spec_id}
                  className="pf-row" onClick={() => onOpenSpec(r.spec_id)}
                  style={{ borderTop: "1px solid var(--pf-bd)", cursor: "pointer" }}
                >
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ fontWeight: 600 }}>{r.entity}</div>
                    <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", fontFamily: "var(--pf-font-mono)" }}>
                      {r.source ?? r.spec_id} · v{r.current_version}
                    </div>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <StatusPill status={r.status} />
                  </td>
                  <td style={{ padding: "10px 16px", minWidth: 130 }}>
                    {r.confidence === null ? (
                      <span style={{ color: "var(--pf-tmut)" }}>—</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 4, borderRadius: 4, background: "var(--pf-track)", overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(r.confidence * 100)}%`,
                              background: confColor(r.confidence),
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 10.8, fontFamily: "var(--pf-font-mono)", color: confColor(r.confidence) }}>
                          {Math.round(r.confidence * 100)}%
                        </span>
                        {r.low_confidence_count > 0 && (
                          <span style={{ fontSize: 9.8, color: "var(--pf-warn)" }}>{r.low_confidence_count} low</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    {r.last_build_status ? (
                      <span
                        style={{
                          fontSize: 10.4,
                          fontWeight: 600,
                          color:
                            r.last_build_status === "succeeded"
                              ? "var(--pf-ok)"
                              : r.last_build_status === "failed"
                                ? "var(--pf-bad)"
                                : "var(--pf-run)",
                        }}
                      >
                        {r.last_build_status}
                      </span>
                    ) : (
                      <span style={{ color: "var(--pf-tmut)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 16px", color: "var(--pf-tsec)" }}>{r.approved_by ?? "—"}</td>
                  <td style={{ padding: "10px 16px", color: "var(--pf-tmut)" }}>{ago(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}


/** Landing hero: live pipeline health + rows trend + quick links. */
function HomeHero({ total, needsHuman }: { total: number; needsHuman: number }) {
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  useEffect(() => {
    const load = () =>
      fetch("/api/recon/ingestion?limit=16")
        .then((r) => (r.ok ? r.json() : { runs: [] }))
        .then((j: { runs: IngestionRun[] }) => setRuns(j.runs ?? []))
        .catch(() => setRuns([]));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const latest = runs[0] ?? null;
  const rows7d = runs.filter((r) => r.started_at && Date.now() - Date.parse(r.started_at) < 7 * 86_400_000);
  const okRate = rows7d.length ? Math.round((rows7d.filter((r) => r.state === "succeeded").length / rows7d.length) * 100) : null;
  const pts = [...runs].reverse().slice(-14);
  const max = Math.max(...pts.map((r) => r.bronze_count ?? 0), 1);
  const W = 340, H = 74;
  return (
    <Card style={{ display: "flex", gap: 24, alignItems: "stretch", padding: "18px 22px" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Ingestion overview</div>
        <div style={{ fontSize: "var(--fs-small)", color: "var(--pf-tsec)", marginTop: 4, lineHeight: 1.6 }}>
          {total === 0
            ? "No pipelines yet. Bring an interface contract and the factory builds the rest."
            : `${total} governed ${total === 1 ? "entity" : "entities"} in production shape. ` +
              (latest ? `Last run ${latest.trigger_type} \u00b7 ${latest.state} \u00b7 ${latest.bronze_count ?? "?"} rows.` : "") +
              (needsHuman > 0 ? ` ${needsHuman} awaiting human attention.` : " Nothing needs attention.")}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--pf-acc)" }}>{rows7d.length}</div>
            <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>runs \u00b7 7d</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: okRate === 100 ? "var(--pf-ok)" : "var(--pf-warn)" }}>{okRate === null ? "\u2014" : `${okRate}%`}</div>
            <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>run success</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{latest?.bronze_count?.toLocaleString() ?? "\u2014"}</div>
            <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>rows in bronze</div>
          </div>
        </div>
      </div>
      <div style={{ width: 360 }}>
        <div style={{ fontSize: 10.4, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          rows per run \u00b7 blue build \u00b7 green scheduled/manual
        </div>
        {pts.length === 0 ? (
          <div style={{ color: "var(--pf-tmut)", fontSize: "var(--fs-small)", paddingTop: 20 }}>no runs yet</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
            {pts.map((r, i) => {
              const h = Math.max(3, ((r.bronze_count ?? 0) / max) * (H - 16));
              const bw = Math.min(20, (W - 8) / pts.length - 4);
              const x = 4 + i * ((W - 8) / pts.length);
              return (
                <rect key={r.run_id + i} x={x} y={H - 2 - h} width={bw} height={h} rx={2}
                  fill={r.trigger_type === "build" ? "var(--pf-acc)" : "var(--pf-ok)"}
                  opacity={r.state === "succeeded" ? 0.85 : 0.3}>
                  <title>{`${r.started_at?.slice(0, 16)} \u00b7 ${r.trigger_type} \u00b7 ${r.bronze_count ?? "?"} rows`}</title>
                </rect>
              );
            })}
          </svg>
        )}
      </div>
    </Card>
  );
}
