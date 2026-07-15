import { useQuery } from "@tanstack/react-query";
import { Card } from "./ui";

interface LinkItem {
  label: string;
  kind: string;
  url: string;
}

const KIND_ICON: Record<string, string> = {
  workflow: "⏱", // timer
  ingestion_pipeline: "⬇", // down arrow
  etl_pipeline: "⚙", // gear
  table: "▦", // grid
  schema: "▥",
  connection: "⛓",
};

/** "Open in Databricks" panel — every workspace asset the factory manages for
 *  a source, deep-linked so reviewers never hunt through the workspace UI. */
export function DbxLinks({ source, compact }: { source: string; compact?: boolean }) {
  const q = useQuery({
    queryKey: ["links", source],
    queryFn: async () => {
      const r = await fetch(`/api/links/${source}`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { workspace_url: string; links: LinkItem[] };
    },
    staleTime: 60_000,
  });
  if (q.isLoading || q.isError || !q.data || q.data.links.length === 0) return null;
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: compact ? 6 : 10 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--fs-h3)" }}>Open in Databricks</span>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          the live assets behind this source
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {q.data.links.map((l) => (
          <a key={l.url} className="pf-dbxlink" href={l.url} target="_blank" rel="noreferrer" title={l.kind}>
            <span aria-hidden>{KIND_ICON[l.kind] ?? "↗"}</span>
            {l.label}
            <span style={{ color: "var(--pf-tmut)", fontWeight: 400 }}>{"↗"}</span>
          </a>
        ))}
      </div>
    </>
  );
  return compact ? <div style={{ margin: "4px 0 10px" }}>{body}</div> : <Card style={{ padding: 16 }}>{body}</Card>;
}

/** Small inline link to a specific workflow run in the Databricks UI. */
export function RunLink({ source, runId }: { source: string; runId: string }) {
  const q = useQuery({
    queryKey: ["run-link", source, runId],
    queryFn: async () => {
      const r = await fetch(`/api/links/run/${source}/${runId}`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { url: string };
    },
    staleTime: 300_000,
  });
  if (!q.data) return null;
  return (
    <a href={q.data.url} target="_blank" rel="noreferrer" style={{ color: "var(--pf-acc)", fontSize: "var(--fs-micro)", textDecoration: "none" }}>
      view run {"↗"}
    </a>
  );
}
