import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono, StatusPill } from "../components/ui";
import Artifacts from "./Artifacts";

export default function Evidence({ specId }: { specId: string | null }) {
  const q = useQuery({
    queryKey: ["evidence", specId],
    queryFn: () => api.evidence(specId!),
    enabled: specId !== null,
  });

  if (!specId) return <p style={{ color: "var(--pf-tsec)" }}>Pick a spec from the Fleet dashboard.</p>;
  if (q.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Loading evidence…</p>;
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
      {/* header */}
      <Card style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
        <Mono>{d.spec.spec_id}</Mono>
        <span style={{ color: "var(--pf-tmut)", fontSize: 11.2 }}>v{d.spec.spec_version}</span>
        <span style={{ color: "var(--pf-tsec)", fontSize: 10.8 }}>
          {d.spec.source.entity} → {d.spec.target.entity}
        </span>
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

      {/* expectations */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pf-bd)", fontWeight: 600, fontSize: 12.1 }}>
          Expectations ({d.expectations.length})
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.8 }}>
          <tbody>
            {d.expectations.map((e) => (
              <tr key={e.name} style={{ borderTop: "1px solid var(--pf-bd)" }}>
                <td style={{ padding: "9px 16px" }}>
                  <Mono>{e.name}</Mono>
                </td>
                <td style={{ padding: "9px 16px", color: "var(--pf-tsec)", fontFamily: "var(--pf-font-mono)", fontSize: 11.2 }}>
                  {e.constraint}
                </td>
                <td style={{ padding: "9px 16px", width: 90 }}>
                  <span
                    style={{
                      fontSize: 10.4,
                      fontWeight: 600,
                      padding: "2px 9px",
                      borderRadius: 20,
                      textTransform: "uppercase",
                      color: e.action === "fail" ? "var(--pf-bad)" : e.action === "drop" ? "var(--pf-warn)" : "var(--pf-tsec)",
                      background: e.action === "fail" ? "var(--pf-bad-soft)" : e.action === "drop" ? "var(--pf-warn-soft)" : "var(--pf-chip)",
                    }}
                  >
                    {e.action}
                  </span>
                </td>
              </tr>
            ))}
            {d.expectations.length === 0 && (
              <tr>
                <td style={{ padding: 16, color: "var(--pf-tmut)" }}>none defined</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

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
        <Artifacts specId={specId} />
      </div>
    </div>
  );
}
