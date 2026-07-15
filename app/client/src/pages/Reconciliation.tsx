import { useEffect, useState } from "react";
import { api, type IngestionRun, type ReconDiff, type ReconRun, type ReconSummary } from "../api";
import { Card, Mono } from "../components/ui";
import { DbxLinks, RunLink } from "../components/DbxLinks";

/** Reconciliation dashboard — fleet-wide loaded counts + match rates vs
 *  thresholds, per-entity trends, drill-down to record diffs (ask #9). */

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(2)}%`;

function rateColor(v: number | null, threshold: number): string {
  if (v === null) return "var(--pf-tmut)";
  if (v < threshold) return "var(--pf-bad)";
  if (v < 1) return "var(--pf-warn)";
  return "var(--pf-ok)";
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card style={{ padding: "12px 16px", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: "var(--fs-small)", color: "var(--pf-tsec)" }}>{label}</div>
      <div style={{ fontSize: "var(--fs-kpi)", fontWeight: 600, color: tone ?? "var(--pf-tpri)" }}>{value}</div>
    </Card>
  );
}

function Trend({ trend, threshold }: { trend: ReconRun[]; threshold: number }) {
  const H = 26;
  const W = 84;
  const n = Math.max(trend.length, 1);
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {trend.map((r, i) => {
        const v = r.attr_match_rate ?? 0;
        const h = Math.max(2, v * (H - 4));
        return (
          <rect
            key={r.recon_id + i}
            x={(i * W) / n}
            y={H - h}
            width={Math.max(2, W / n - 2)}
            height={h}
            rx={1}
            fill={rateColor(r.attr_match_rate, threshold)}
            opacity={0.85}
          >
            <title>{`${r.started_at ?? ""} attr ${pct(r.attr_match_rate)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function Reconciliation() {
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<{ entity: string; runs: ReconRun[] } | null>(null);
  const [diffs, setDiffs] = useState<{ reconId: string; rows: ReconDiff[] } | null>(null);

  const load = () => {
    api
      .reconSummary()
      .then((s) => {
        setSummary(s);
        setError("");
      })
      .catch((e) => setError(String(e)));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <Card style={{ borderColor: "var(--pf-bad)", padding: 16 }}>
        <span style={{ color: "var(--pf-bad)" }}>reconciliation data unavailable: {error}</span>
      </Card>
    );
  }
  if (!summary) return <div style={{ color: "var(--pf-tsec)", padding: 24 }}>loading…</div>;

  const { kpis, thresholds } = summary;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} className="pf-fadein">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1 style={{ fontSize: "var(--fs-h1)", margin: 0 }}>Reconciliation</h1>
        <Mono style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          source ↔ target parity · thresholds key ≥ {thresholds.key} · attr ≥ {thresholds.attr} · reads:{" "}
          {summary.backend}
        </Mono>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Kpi label="Entities reconciled" value={String(kpis.entities)} />
        <Kpi label="Rows loaded (latest)" value={kpis.rows_loaded_last_batch.toLocaleString()} />
        <Kpi label="Runs (7d)" value={String(kpis.runs_7d)} />
        <Kpi
          label="Failed runs (7d)"
          value={String(kpis.failed_runs_7d)}
          tone={kpis.failed_runs_7d > 0 ? "var(--pf-bad)" : "var(--pf-ok)"}
        />
        <Kpi label="Avg key match" value={pct(kpis.avg_key_rate)} tone={rateColor(kpis.avg_key_rate, thresholds.key)} />
        <Kpi label="Avg row match" value={pct(kpis.avg_row_rate)} tone={rateColor(kpis.avg_row_rate, 1)} />
        <Kpi
          label="Avg attribute match"
          value={pct(kpis.avg_attr_rate)}
          tone={rateColor(kpis.avg_attr_rate, thresholds.attr)}
        />
        <Kpi
          label="Below threshold"
          value={String(kpis.below_threshold)}
          tone={kpis.below_threshold > 0 ? "var(--pf-bad)" : "var(--pf-ok)"}
        />
      </div>

      <IngestionPanel />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
          <thead>
            <tr style={{ color: "var(--pf-tsec)", textAlign: "left" }}>
              {["Entity", "Last run", "Status", "Source rows", "Target rows", "Key", "Row", "Attribute", "Trend (attr)", ""].map(
                (h) => (
                  <th key={h} style={{ padding: "8px 12px", borderBottom: "1px solid var(--pf-bd)" }}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {summary.entities.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 16, color: "var(--pf-tmut)" }}>
                  No reconciliation runs yet — run a build to produce parity evidence.
                </td>
              </tr>
            )}
            {summary.entities.map(({ entity, latest, trend }) => (
              <tr key={entity} className="pf-row-hover">
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{entity}</td>
                <td style={{ padding: "8px 12px", color: "var(--pf-tsec)" }}>
                  <Mono>{latest.started_at?.slice(0, 19) ?? "n/a"}</Mono>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ color: latest.status === "succeeded" ? "var(--pf-ok)" : "var(--pf-bad)" }}>
                    {latest.status ?? "n/a"}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}>{latest.source_count?.toLocaleString() ?? "n/a"}</td>
                <td style={{ padding: "8px 12px" }}>{latest.target_count?.toLocaleString() ?? "n/a"}</td>
                <td style={{ padding: "8px 12px", color: rateColor(latest.key_match_rate, thresholds.key), fontWeight: 600 }}>
                  {pct(latest.key_match_rate)}
                </td>
                <td style={{ padding: "8px 12px", color: rateColor(latest.row_match_rate, 1) }}>{pct(latest.row_match_rate)}</td>
                <td style={{ padding: "8px 12px", color: rateColor(latest.attr_match_rate, thresholds.attr), fontWeight: 600 }}>
                  {pct(latest.attr_match_rate)}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <Trend trend={trend} threshold={thresholds.attr} />
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <button
                    className="pf-btn"
                    onClick={() =>
                      api.reconRuns(entity).then((r) => setDrill({ entity, runs: r.runs }))
                    }
                  >
                    runs
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {drill && (
        <Card style={{ padding: 14 }} className="pf-fadein">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Run history — {drill.entity}</strong>
            <button className="pf-btn" onClick={() => setDrill(null)}>
              close
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
            <thead>
              <tr style={{ color: "var(--pf-tsec)", textAlign: "left" }}>
                {["recon id", "started", "status", "src", "tgt", "key", "row", "attr", ""].map((h) => (
                  <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--pf-bd)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drill.runs.map((r) => (
                <tr key={r.recon_id}>
                  <td style={{ padding: "6px 10px" }}>
                    <Mono>{r.recon_id.slice(0, 8)}</Mono>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <Mono>{r.started_at?.slice(0, 19) ?? ""}</Mono>
                  </td>
                  <td style={{ padding: "6px 10px", color: r.status === "succeeded" ? "var(--pf-ok)" : "var(--pf-bad)" }}>
                    {r.status}
                  </td>
                  <td style={{ padding: "6px 10px" }}>{r.source_count ?? ""}</td>
                  <td style={{ padding: "6px 10px" }}>{r.target_count ?? ""}</td>
                  <td style={{ padding: "6px 10px" }}>{pct(r.key_match_rate)}</td>
                  <td style={{ padding: "6px 10px" }}>{pct(r.row_match_rate)}</td>
                  <td style={{ padding: "6px 10px" }}>{pct(r.attr_match_rate)}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <button
                      className="pf-btn"
                      onClick={() =>
                        api.reconDiffs(r.recon_id, drill.entity).then((d) => setDiffs({ reconId: r.recon_id, rows: d.diffs }))
                      }
                    >
                      diffs
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {diffs && (
        <Card style={{ padding: 14 }} className="pf-fadein">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>
              Record diffs — <Mono>{diffs.reconId.slice(0, 8)}</Mono>
            </strong>
            <button className="pf-btn" onClick={() => setDiffs(null)}>
              close
            </button>
          </div>
          {diffs.rows.length === 0 ? (
            <span style={{ color: "var(--pf-ok)" }}>no record-level differences captured for this run</span>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
              <thead>
                <tr style={{ color: "var(--pf-tsec)", textAlign: "left" }}>
                  {["key", "column", "source value", "target value"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--pf-bd)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diffs.rows.map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: "6px 10px" }}>
                      <Mono>{d.key_value}</Mono>
                    </td>
                    <td style={{ padding: "6px 10px" }}>{d.column_name}</td>
                    <td style={{ padding: "6px 10px", color: "var(--pf-warn)" }}>
                      <Mono>{d.source_value ?? "NULL"}</Mono>
                    </td>
                    <td style={{ padding: "6px 10px", color: "var(--pf-warn)" }}>
                      <Mono>{d.target_value ?? "NULL"}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

/** Ingestion run log (ADR-011): every workflow run — build, cron, manual —
 *  with counts and derived row deltas. The proof that scheduled runs leave evidence. */
function IngestionPanel() {
  const [runs, setRuns] = useState<IngestionRun[] | null>(null);
  useEffect(() => {
    const load = () => api.reconIngestion().then((r) => setRuns(r.runs)).catch(() => setRuns([]));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!runs || runs.length === 0) return null;
  const firstSource = runs[0]?.source ?? null;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--pf-bd)", display: "flex", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: "var(--fs-h3)" }}>Ingestion runs</strong>
        <Mono style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          every workflow execution — scheduled runs included
        </Mono>
      </div>
      <RowsTrend runs={runs} />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
        <thead>
          <tr style={{ color: "var(--pf-tsec)", textAlign: "left" }}>
            {["When", "Source / entity", "Trigger", "State", "Bronze", "Silver", "Δ rows", "SLA", ""].map((h) => (
              <th key={h} style={{ padding: "7px 12px", borderBottom: "1px solid var(--pf-bd)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.slice(0, 12).map((r, i) => (
            <tr key={r.run_id + i} className="pf-row-hover">
              <td style={{ padding: "6px 12px" }}><Mono>{r.started_at?.slice(0, 19)}</Mono></td>
              <td style={{ padding: "6px 12px", fontWeight: 600 }}>{r.source} / {r.entity}</td>
              <td style={{ padding: "6px 12px" }}>
                <span style={{ padding: "1px 8px", borderRadius: "var(--rad)", fontSize: "var(--fs-micro)",
                  background: r.trigger_type === "build" ? "var(--pf-acc-soft)" : "var(--pf-ok-soft)",
                  color: r.trigger_type === "build" ? "var(--pf-acc)" : "var(--pf-ok)" }}>
                  {r.trigger_type ?? "?"}
                </span>
              </td>
              <td style={{ padding: "6px 12px", color: r.state === "succeeded" ? "var(--pf-ok)" : "var(--pf-bad)" }}>{r.state}</td>
              <td style={{ padding: "6px 12px" }}>{r.bronze_count?.toLocaleString() ?? "—"}</td>
              <td style={{ padding: "6px 12px" }}>{r.silver_count?.toLocaleString() ?? "—"}</td>
              <td style={{ padding: "6px 12px", color: (r.rows_delta ?? 0) !== 0 ? "var(--pf-tpri)" : "var(--pf-tmut)" }}>
                {r.rows_delta === null ? "first run" : (r.rows_delta >= 0 ? "+" : "") + r.rows_delta}
              </td>
              <td style={{ padding: "6px 12px" }}>
                {r.sla_breach === null ? <span style={{ color: "var(--pf-tmut)" }}>—</span> : r.sla_breach ? <span style={{ color: "var(--pf-bad)", fontWeight: 600 }}>BREACH</span> : <span style={{ color: "var(--pf-ok)" }}>ok</span>}
              </td>
              <td style={{ padding: "6px 12px" }}>
                {r.source && <RunLink source={r.source} runId={r.run_id} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {firstSource && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--pf-bd)" }}>
          <DbxLinks source={firstSource} compact />
        </div>
      )}
    </Card>
  );
}

/** Rows-loaded trend: one bar per run (oldest -> newest), colored by trigger.
 *  Pure SVG — zero chart dependencies, glass-friendly. */
function RowsTrend({ runs }: { runs: IngestionRun[] }) {
  const pts = [...runs].reverse().slice(-16);
  const max = Math.max(...pts.map((r) => r.bronze_count ?? 0), 1);
  const W = 640, H = 92, pad = 8;
  const bw = Math.min(34, (W - pad * 2) / pts.length - 6);
  return (
    <div style={{ padding: "12px 14px 4px", borderBottom: "1px solid var(--pf-bd)" }}>
      <div style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)", marginBottom: 4 }}>
        rows in bronze per run (last {pts.length}) — blue = build, green = scheduled/manual
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 720, height: H }}>
        {pts.map((r, i) => {
          const h = Math.max(3, ((r.bronze_count ?? 0) / max) * (H - 30));
          const x = pad + i * ((W - pad * 2) / pts.length);
          const color = r.trigger_type === "build" ? "var(--pf-acc)" : "var(--pf-ok)";
          return (
            <g key={r.run_id + i}>
              <rect x={x} y={H - 18 - h} width={bw} height={h} rx={3} fill={color} opacity={r.state === "succeeded" ? 0.85 : 0.3}>
                <title>{`${r.started_at?.slice(0, 16)} · ${r.trigger_type} · bronze ${r.bronze_count}`}</title>
              </rect>
              <text x={x + bw / 2} y={H - 22 - h} textAnchor="middle" fontSize="9" fill="var(--pf-tsec)">
                {r.bronze_count ?? ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
