import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono, StatusPill } from "../components/ui";

export default function Fleet({ onOpenSpec }: { onOpenSpec: (specId: string) => void }) {
  const specs = useQuery({ queryKey: ["specs"], queryFn: api.listSpecs, refetchInterval: 30_000 });

  if (specs.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Loading fleet…</p>;
  if (specs.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(specs.error)}</p>;

  const rows = specs.data?.specs ?? [];
  const kpi = (label: string, value: number | string) => (
    <Card style={{ flex: 1, padding: "14px 18px" }}>
      <div style={{ fontSize: 11, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12 }}>
        {kpi("Specs", rows.length)}
        {kpi("Approved", rows.filter((r) => r.status === "approved").length)}
        {kpi("Awaiting review", rows.filter((r) => r.status === "generated").length)}
        {kpi("Needs human", rows.filter((r) => r.status === "needs_human").length)}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p style={{ padding: 24, color: "var(--pf-tsec)" }}>
            No specs yet — start with Contract intake.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--pf-tmut)", textAlign: "left", background: "var(--pf-surf2)" }}>
                <th style={{ padding: "10px 16px" }}>Entity</th>
                <th style={{ padding: "10px 16px" }}>Spec</th>
                <th style={{ padding: "10px 16px" }}>Status</th>
                <th style={{ padding: "10px 16px" }}>Version</th>
                <th style={{ padding: "10px 16px" }}>Approved by</th>
                <th style={{ padding: "10px 16px" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.spec_id}
                  onClick={() => onOpenSpec(r.spec_id)}
                  style={{ borderTop: "1px solid var(--pf-bd)", cursor: "pointer" }}
                >
                  <td style={{ padding: "10px 16px", fontWeight: 600 }}>{r.entity}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <Mono>{r.spec_id}</Mono>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <StatusPill status={r.status} />
                  </td>
                  <td style={{ padding: "10px 16px", color: "var(--pf-tsec)" }}>v{r.current_version}</td>
                  <td style={{ padding: "10px 16px", color: "var(--pf-tsec)" }}>{r.approved_by ?? "—"}</td>
                  <td style={{ padding: "10px 16px", color: "var(--pf-tmut)" }}>{r.updated_at ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
