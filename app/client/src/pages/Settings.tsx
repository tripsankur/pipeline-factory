import { useQuery } from "@tanstack/react-query";
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
