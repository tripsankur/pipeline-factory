import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Mono } from "../components/ui";

export default function Artifacts({ specId }: { specId: string | null }) {
  const q = useQuery({
    queryKey: ["artifacts", specId],
    queryFn: () => api.getArtifacts(specId!),
    enabled: specId !== null,
  });
  const [selected, setSelected] = useState(0);
  const build = useMutation({ mutationFn: () => api.build(specId!) });

  if (!specId) return <p style={{ color: "var(--pf-tsec)" }}>Approve a spec first, then preview its rendered artifacts here.</p>;
  if (q.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Rendering…</p>;
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const files = q.data?.files ?? [];
  const current = files[selected];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 12, color: "var(--pf-tmut)" }}>branch </span>
        <Mono>{q.data?.branch}</Mono>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {build.isSuccess && (
            <span style={{ fontSize: 12.5, color: "var(--pf-ok)" }}>
              PR opened via {build.data.adapter}:{" "}
              {build.data.pr.url.startsWith("http") ? (
                <a href={build.data.pr.url} target="_blank" rel="noreferrer" style={{ color: "var(--pf-acc)" }}>
                  #{build.data.pr.number}
                </a>
              ) : (
                <Mono>{build.data.pr.url}</Mono>
              )}
            </span>
          )}
          {build.isError && (
            <span style={{ fontSize: 12.5, color: "var(--pf-bad)" }}>{String(build.error).slice(0, 160)}</span>
          )}
          <Button onClick={() => build.mutate()} disabled={build.isPending}>
            {build.isPending ? "Building…" : "Build & open PR"}
          </Button>
        </div>
      </Card>
      <div style={{ display: "flex", gap: 12, minHeight: 480 }}>
        <Card style={{ width: 300, padding: 8, flexShrink: 0 }}>
          {files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setSelected(i)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--pf-font-mono)",
                fontSize: 11.5,
                background: i === selected ? "var(--pf-acc-soft)" : "transparent",
                color: i === selected ? "var(--pf-acc)" : "var(--pf-tsec)",
              }}
            >
              {f.path.replace(/^pipelines\/[^/]+\//, "")}
            </button>
          ))}
        </Card>
        <Card style={{ flex: 1, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--pf-bd)",
              fontSize: 11.5,
              color: "var(--pf-tmut)",
              fontFamily: "var(--pf-font-mono)",
            }}
          >
            {current?.path} · sha256 {current?.sha256.slice(0, 12)}…
          </div>
          <pre
            style={{
              margin: 0,
              padding: 16,
              overflow: "auto",
              maxHeight: 520,
              fontSize: 12,
              fontFamily: "var(--pf-font-mono)",
              background: "var(--pf-code-bg)",
              color: "var(--pf-tpri)",
            }}
          >
            {current?.content}
          </pre>
        </Card>
      </div>
    </div>
  );
}
