import { useQuery } from "@tanstack/react-query";
import { api, type SpecRow } from "../api";
import { Card, Mono } from "./ui";

/** Shared spec selector — every spec-scoped page (Mapping, Build, Evidence,
 *  History) lets the user pick/switch in place instead of dead-ending when
 *  nothing was pushed in from Fleet/Intake. */

const STATUS_COLOR: Record<string, string> = {
  generated: "var(--pf-warn)",
  approved: "var(--pf-ok)",
  building: "var(--pf-run)",
  pr_open: "var(--pf-run)",
  needs_human: "var(--pf-bad)",
};

export function SpecPicker({
  selected,
  onSelect,
  hint,
  emphasize,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  hint: string;
  /** statuses this page can act on — rows outside it render dimmed */
  emphasize?: string[];
}) {
  const list = useQuery({ queryKey: ["specs"], queryFn: api.listSpecs, refetchInterval: 30_000 });
  const specs: SpecRow[] = list.data?.specs ?? [];

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--pf-bd)", display: "flex", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: "var(--fs-h3)" }}>Specs</strong>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>{hint}</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-table)" }}>
        <tbody>
          {specs.map((s) => {
            const actionable = !emphasize || emphasize.includes(s.status);
            return (
              <tr
                key={s.spec_id}
                className="pf-row"
                onClick={() => onSelect(s.spec_id)}
                style={{
                  cursor: "pointer",
                  opacity: actionable ? 1 : 0.55,
                  background: s.spec_id === selected ? "var(--pf-acc-soft)" : undefined,
                }}
              >
                <td style={{ padding: "7px 14px", fontWeight: 600 }}>{s.entity}</td>
                <td style={{ padding: "7px 14px" }}>
                  <Mono>{s.spec_id}</Mono>
                  <span style={{ color: "var(--pf-tmut)", marginLeft: 6 }}>v{s.current_version}</span>
                </td>
                <td style={{ padding: "7px 14px" }}>
                  <span style={{ color: STATUS_COLOR[s.status] ?? "var(--pf-tsec)" }}>{s.status}</span>
                </td>
                <td style={{ padding: "7px 14px", color: "var(--pf-tmut)", fontSize: "var(--fs-micro)" }}>
                  {s.updated_at?.slice(0, 19)}
                </td>
              </tr>
            );
          })}
          {list.data && specs.length === 0 && (
            <tr>
              <td style={{ padding: 14, color: "var(--pf-tmut)" }}>No specs yet — generate one via Contract intake.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
