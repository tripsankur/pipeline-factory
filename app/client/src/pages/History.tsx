import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Mono } from "../components/ui";
import { SpecPicker } from "../components/SpecPicker";

interface VersionRow {
  spec_version: number;
  change_reason: string | null;
  created_at: string | null;
  created_by: string | null;
}

export default function History({ specId }: { specId: string | null }) {
  const [selected, setSelected] = useState<string | null>(specId);
  useEffect(() => {
    if (specId) setSelected(specId);
  }, [specId]);
  const q = useQuery({
    queryKey: ["spec", selected],
    queryFn: () => api.getSpec(selected!),
    enabled: selected !== null,
  });

  const picker = (
    <SpecPicker selected={selected} onSelect={setSelected} hint="pick a spec to see its version history" />
  );
  if (!selected) return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{picker}</div>;
  if (q.isLoading)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {picker}
        <p style={{ color: "var(--pf-tsec)" }}>Loading history…</p>
      </div>
    );
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const versions = (q.data?.versions ?? []) as VersionRow[];

  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 12 }}>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "var(--fs-small)", color: "var(--pf-acc)" }}>Switch spec</summary>
        <div style={{ marginTop: 8 }}>{picker}</div>
      </details>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--pf-bd)", display: "flex", gap: 10 }}>
          <Mono>{selected}</Mono>
          <span style={{ color: "var(--pf-tmut)", fontSize: 10.8 }}>
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
                fontSize: 12.1,
                color: i === 0 ? "var(--pf-acc)" : "var(--pf-tsec)",
                minWidth: 36,
              }}
            >
              v{v.spec_version}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.1 }}>{v.change_reason ?? "—"}</div>
              <div style={{ fontSize: 10.8, color: "var(--pf-tmut)", marginTop: 2 }}>
                {v.created_by ?? "unknown"} · {v.created_at ?? "—"}
              </div>
            </div>
            {i === 0 && (
              <span
                style={{
                  fontSize: 9.8,
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
