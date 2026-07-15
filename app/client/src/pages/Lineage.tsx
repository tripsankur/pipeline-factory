import { useQuery } from "@tanstack/react-query";
import { Card, Mono } from "../components/ui";

interface BatchFlow {
  flow: string;
  entity: string;
  spec_id: string;
  spec_version: number;
  source_object: string;
  destination: string;
  ingestion_mode: string;
  cursor_column: string | null;
}

interface IngestionBatch {
  batch_id: string;
  source_system: string;
  mode: "batch" | "nrt";
  transport: string;
  flows: BatchFlow[];
}

interface LineageEntity {
  spec_id: string;
  spec_version: number;
  entity: string;
  source_system: string;
  source_object: string;
  bronze_table: string;
  target_table: string;
  target_system: string;
  mode: string;
  column_count: number;
}

interface LineageData {
  batches: IngestionBatch[];
  entities: LineageEntity[];
}

async function fetchLineage(): Promise<LineageData> {
  const r = await fetch("/api/lineage");
  if (!r.ok) throw new Error(`lineage failed: ${r.status}`);
  return r.json();
}

/** Column x-positions for the 5-stage lineage DAG. */
const COLS = [
  { x: 30, w: 150, label: "Source system" },
  { x: 220, w: 175, label: "Ingestion (brnz)" },
  { x: 435, w: 205, label: "Bronze" },
  { x: 680, w: 175, label: "Silver stitch" },
  { x: 895, w: 205, label: "Target" },
] as const;
const NODE_H = 44;
const GAP = 16;

export default function Lineage({ onOpenSpec }: { onOpenSpec: (id: string) => void }) {
  const q = useQuery({ queryKey: ["lineage"], queryFn: fetchLineage, refetchInterval: 60_000 });

  if (q.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Deriving lineage from the registry…</p>;
  if (q.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(q.error)}</p>;

  const { batches, entities } = q.data!;
  if (entities.length === 0) {
    return <p style={{ color: "var(--pf-tsec)" }}>No specs in the registry yet — lineage appears after the first generation.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--pf-tmut)", maxWidth: 760 }}>
        Single source of truth, derived live from the registry's current spec versions. One scheduled{" "}
        <Mono>batch</Mono> per source carries all its tables; <Mono>nrt</Mono> groups carry cdc entities.
        Flow naming: <Mono>brnz_&#123;source&#125;_&#123;entity&#125;_&#123;mode&#125;</Mono>.
      </p>
      {batches.map((batch) => (
        <SourceGraph
          key={batch.batch_id}
          batch={batch}
          entities={entities.filter(
            (e) => e.source_system === batch.source_system && batch.flows.some((f) => f.spec_id === e.spec_id),
          )}
          onOpenSpec={onOpenSpec}
        />
      ))}
    </div>
  );
}

function SourceGraph({
  batch,
  entities,
  onOpenSpec,
}: {
  batch: IngestionBatch;
  entities: LineageEntity[];
  onOpenSpec: (id: string) => void;
}) {
  const rows = Math.max(entities.length, 1);
  const height = 70 + rows * (NODE_H + GAP);
  const rowY = (i: number) => 58 + i * (NODE_H + GAP);
  const midY = (i: number) => rowY(i) + NODE_H / 2;
  const centerY = 58 + (rows * (NODE_H + GAP) - GAP) / 2;

  const edge = (x1: number, y1: number, x2: number, y2: number, key: string, color = "var(--pf-acc)") => {
    const mx = (x1 + x2) / 2;
    return (
      <path
        key={key}
        className="pf-flow-edge"
        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
        stroke={color}
        strokeWidth={1.4}
        fill="none"
        opacity={0.75}
      />
    );
  };

  const node = (
    col: number,
    y: number,
    title: string,
    sub: string,
    opts: { accent?: boolean; mono?: boolean; onClick?: () => void; pill?: string } = {},
  ) => {
    const c = COLS[col]!;
    return (
      <g
        key={`${col}-${y}-${title}`}
        onClick={opts.onClick}
        style={{ cursor: opts.onClick ? "pointer" : "default" }}
        className="pf-pop"
      >
        <rect
          x={c.x}
          y={y}
          width={c.w}
          height={NODE_H}
          rx={9}
          fill={opts.accent ? "var(--pf-acc-soft)" : "var(--pf-surf)"}
          stroke={opts.accent ? "var(--pf-acc)" : "var(--pf-bd2)"}
          strokeWidth={1.1}
        />
        <text
          x={c.x + 11}
          y={y + 18}
          fill={opts.accent ? "var(--pf-acc)" : "var(--pf-tpri)"}
          fontSize={10.5}
          fontWeight={600}
          fontFamily={opts.mono ? "var(--pf-font-mono)" : "var(--pf-font-sans)"}
        >
          {title.length > 30 ? `${title.slice(0, 29)}…` : title}
        </text>
        <text x={c.x + 11} y={y + 33} fill="var(--pf-tmut)" fontSize={8.8} fontFamily="var(--pf-font-mono)">
          {sub.length > 34 ? `…${sub.slice(-33)}` : sub}
        </text>
        {opts.pill && (
          <>
            <rect x={c.x + c.w - 44} y={y + 7} width={36} height={14} rx={7} fill="var(--pf-chip)" />
            <text x={c.x + c.w - 26} y={y + 17} textAnchor="middle" fill="var(--pf-tmut)" fontSize={7.8}>
              {opts.pill}
            </text>
          </>
        )}
      </g>
    );
  };

  return (
    <Card style={{ padding: "14px 18px", overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{batch.source_system}</span>
        <Mono>{batch.batch_id}</Mono>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            padding: "2px 8px",
            borderRadius: 20,
            color: batch.mode === "nrt" ? "var(--pf-run)" : "var(--pf-acc)",
            background: batch.mode === "nrt" ? "rgba(56,189,248,0.14)" : "var(--pf-acc-soft)",
          }}
        >
          {batch.mode === "nrt" ? "near-real-time" : "scheduled batch"}
        </span>
        <span style={{ fontSize: 10.5, color: "var(--pf-tmut)" }}>
          {batch.flows.length} table{batch.flows.length > 1 ? "s" : ""} · {batch.transport}
        </span>
      </div>

      <svg width={1120} height={height} style={{ display: "block" }}>
        {COLS.map((c) => (
          <text key={c.label} x={c.x} y={20} fill="var(--pf-tmut)" fontSize={8.5} letterSpacing={1} style={{ textTransform: "uppercase" }}>
            {c.label.toUpperCase()}
          </text>
        ))}

        {/* source system + batch node span the vertical center */}
        {node(0, centerY - NODE_H / 2, batch.source_system, `${entities.length} objects`, { accent: false })}
        {node(1, centerY - NODE_H / 2, batch.batch_id, batch.mode === "nrt" ? "continuous" : "all tables, one schedule", {
          accent: true,
          mono: true,
        })}
        {edge(COLS[0].x + COLS[0].w, centerY, COLS[1].x, centerY, "src-batch")}

        {entities.map((e, i) => (
          <g key={e.spec_id}>
            {edge(COLS[1].x + COLS[1].w, centerY, COLS[2].x, midY(i), `b-${i}`)}
            {node(2, rowY(i), e.bronze_table.split(".").pop() ?? e.bronze_table, e.bronze_table, {
              mono: true,
              pill: e.mode === "cdc" ? "nrt" : "batch",
              onClick: () => onOpenSpec(e.spec_id),
            })}
            {edge(COLS[2].x + COLS[2].w, midY(i), COLS[3].x, midY(i), `s-${i}`, "var(--pf-violet)")}
            {node(3, rowY(i), "silver_transform", "ruleset: transforms + DQ", {
              mono: true,
              pill: `${e.column_count} cols`,
              onClick: () => onOpenSpec(e.spec_id),
            })}
            {edge(COLS[3].x + COLS[3].w, midY(i), COLS[4].x, midY(i), `t-${i}`, "var(--pf-ok)")}
            {node(4, rowY(i), e.target_table.split(".").pop() ?? e.target_table, `${e.target_system} · v${e.spec_version}`, {
              mono: true,
              onClick: () => onOpenSpec(e.spec_id),
            })}
          </g>
        ))}
      </svg>
    </Card>
  );
}
