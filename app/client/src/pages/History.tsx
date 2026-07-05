import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono } from "../components/ui";

interface VersionRow {
  spec_version: number;
  change_reason: string | null;
  created_at: string | null;
  created_by: string | null;
}

export default function History({ specId }: { specId: string | null }) {
  const q = useQuery({
    queryKey: ["spec", specId],
    queryFn: () => api.getSpec(specId!),
    enabled: specId !== null,
  });

  if (!specId) return <p style={{ color: "var(--pf-tsec)" }}>Pick a spec from the Fleet dashboard.</p>;
  if (q.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Loading history…</p>;
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const versions = (q.data?.versions ?? []) as VersionRow[];

  return (
    <div style={{ maxWidth: 760 }}>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--pf-bd)", display: "flex", gap: 10 }}>
          <Mono>{specId}</Mono>
          <span style={{ color: "var(--pf-tmut)", fontSize: 12.5 }}>
            {versions.length} version{versions.length === 1 ? "" : "s"} — append-only audit trail
          </span>
        </div>
        {versions.map((v, i) => (
          <div
            key={v.spec_version}
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--pf-bd)",
              display: "flex",
              gap: 14,
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontFamily: "var(--pf-font-mono)",
                fontWeight: 700,
                fontSize: 13,
                color: i === 0 ? "var(--pf-acc)" : "var(--pf-tsec)",
                minWidth: 36,
              }}
            >
              v{v.spec_version}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13 }}>{v.change_reason ?? "—"}</div>
              <div style={{ fontSize: 11.5, color: "var(--pf-tmut)", marginTop: 2 }}>
                {v.created_by ?? "unknown"} · {v.created_at ?? "—"}
              </div>
            </div>
            {i === 0 && (
              <span
                style={{
                  fontSize: 10.5,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: "var(--pf-acc-soft)",
                  color: "var(--pf-acc)",
                }}
              >
                current
              </span>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
