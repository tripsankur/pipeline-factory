/** Typed API client for the Pipeline Factory server. */

export interface ContractColumn {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
  sample?: string;
}

export interface ParsedContract {
  entity: string;
  columns: ContractColumn[];
  narrative: string;
  sourceKind: "csv" | "docx" | "confluence";
}

export interface ColumnMapping {
  name: string;
  target: string;
  type: string;
  transform: string | null;
  value_map: { from: string; to: string }[];
  confidence: number;
  rationale: string;
  compare: { enabled: boolean; normalize: string | null; tolerance: number | null };
}

export interface Spec {
  spec_id: string;
  spec_version: number;
  entity: string;
  source: { system: string; entity: string };
  target: { system: string; entity: string };
  ingestion: {
    transport: string;
    source_object: string;
    mode: string;
    cursor_column: string | null;
  };
  primary_keys: { source: string; target: string }[];
  columns: ColumnMapping[];
  expectations: { name: string; constraint: string; action: string }[];
  evidence: Record<string, unknown>;
}

export interface SpecRow {
  spec_id: string;
  entity: string;
  status: string;
  current_version: number;
  created_by: string | null;
  approved_by: string | null;
  updated_at: string | null;
}

export interface RenderedFile {
  path: string;
  content: string;
  sha256: string;
}

export interface FleetSpec {
  spec_id: string;
  entity: string;
  status: string;
  current_version: number;
  approved_by: string | null;
  updated_at: string | null;
  source: string | null;
  confidence: number | null;
  low_confidence_count: number;
  column_count: number;
  last_build_status: string | null;
  last_pr_url: string | null;
}

export interface FleetKpis {
  total: number;
  approved: number;
  pr_open: number;
  needs_human: number;
  awaiting_review: number;
}

export interface EvidenceData {
  spec: Spec;
  builds: {
    run_id: string;
    status: string;
    pr_url: string | null;
    branch: string | null;
    fix_iteration: string;
    detail: string | null;
    started_at: string | null;
    finished_at: string | null;
  }[];
  recon: {
    source_count: string | null;
    target_count: string | null;
    key_match_rate: string | null;
    row_match_rate: string | null;
    attr_match_rate: string | null;
    created_at: string | null;
  } | null;
  fixes: { version: string; reason: string }[];
  expectations: { name: string; constraint: string; action: string }[];
  approvals: unknown[];
}

export interface FeatureDef {
  id: string;
  title: string;
  promise: string;
  roadmap: "next" | "later" | "research";
  available: boolean;
}

export interface BuildEvent {
  type: "step" | "log" | "fix" | "done" | "error";
  step?: string;
  status?: "running" | "done" | "deferred" | "failed";
  meta?: string;
  text?: string;
  iteration?: number;
  maxIterations?: number;
  pr?: { url: string; number: number };
  run_id?: string;
}

/** Live build via SSE. Returns a cancel function. */
export function streamBuild(specId: string, onEvent: (e: BuildEvent) => void, onEnd: () => void): () => void {
  const es = new EventSource(`/api/specs/${specId}/build/stream`);
  es.onmessage = (m) => onEvent(JSON.parse(m.data) as BuildEvent);
  es.onerror = () => {
    es.close();
    onEnd();
  };
  return () => es.close();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

export interface ParsedTableContract extends ParsedContract {
  table: string;
  sourceObject: string;
  mode: "snapshot" | "incremental" | "cdc";
  cursorColumn: string | null;
  primaryKey: string[];
  suggested: {
    sourceEntity: string;
    targetEntity: string;
    sourceSystem: string;
    targetSystem: string;
  };
}

export type ParseResponse =
  | { kind: "freeform"; contract: ParsedContract }
  | {
      kind: "structured";
      contract_info: {
        contract_id: string;
        contract_version: number;
        source_system: string;
        owner: string;
        name: string;
        batch_schedule: string;
        environments: string[];
        connectivity: Record<string, string>;
      };
      tables: ParsedTableContract[];
      audit: Record<string, unknown>;
    };

export interface ReconRun {
  recon_id: string;
  run_id: string | null;
  spec_id: string | null;
  entity: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  source_count: number | null;
  target_count: number | null;
  key_match_rate: number | null;
  row_match_rate: number | null;
  attr_match_rate: number | null;
}

export interface ReconSummary {
  thresholds: { key: number; attr: number };
  backend: "lakebase" | "warehouse";
  kpis: {
    entities: number;
    runs_7d: number;
    failed_runs_7d: number;
    rows_loaded_last_batch: number;
    avg_key_rate: number | null;
    avg_row_rate: number | null;
    avg_attr_rate: number | null;
    below_threshold: number;
  };
  entities: { entity: string; latest: ReconRun; trend: ReconRun[] }[];
}

export interface IngestionRun {
  run_id: string;
  source: string | null;
  entity: string | null;
  trigger_type: string | null;
  state: string | null;
  bronze_count: number | null;
  silver_count: number | null;
  rows_delta: number | null;
  started_at: string | null;
  finished_at: string | null;
  detail: string | null;
  sla_breach: boolean | null;
}

export interface ReconDiff {
  entity: string;
  key_value: string;
  column_name: string;
  source_value: string | null;
  target_value: string | null;
  created_at: string | null;
}

export const api = {
  parseContract: async (file: File): Promise<ParseResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    return json(await fetch("/api/contracts/parse", { method: "POST", body: fd }));
  },
  generateSpec: async (body: {
    contract: ParsedContract;
    sourceSystem: string;
    targetSystem: string;
    sourceEntity: string;
    targetEntity: string;
    mode?: string;
    cursorColumn?: string | null;
    audit?: Record<string, unknown>;
  }): Promise<{ spec: Spec }> =>
    json(
      await fetch("/api/specs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  listSpecs: async (): Promise<{ specs: SpecRow[] }> => json(await fetch("/api/specs")),
  getSpec: async (id: string): Promise<{ spec: Spec; versions: unknown[] }> =>
    json(await fetch(`/api/specs/${id}`)),
  approveSpec: async (id: string, spec: Spec): Promise<{ spec: Spec; approved_by: string }> =>
    json(
      await fetch(`/api/specs/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      }),
    ),
  getArtifacts: async (
    id: string,
  ): Promise<{ branch: string; commit_message: string; files: RenderedFile[] }> =>
    json(await fetch(`/api/specs/${id}/artifacts`)),
  build: async (
    id: string,
  ): Promise<{ run_id: string; pr: { url: string; number: number }; adapter: string; logs: string[] }> =>
    json(await fetch(`/api/specs/${id}/build`, { method: "POST" })),
  fleet: async (): Promise<{ specs: FleetSpec[]; kpis: FleetKpis }> => json(await fetch("/api/fleet")),
  reconSummary: async (): Promise<ReconSummary> => json(await fetch("/api/recon/summary")),
  reconRuns: async (entity?: string): Promise<{ runs: ReconRun[] }> =>
    json(await fetch(`/api/recon/runs${entity ? `?entity=${encodeURIComponent(entity)}` : ""}`)),
  reconIngestion: async (entity?: string): Promise<{ runs: IngestionRun[]; backend: string }> =>
    json(await fetch(`/api/recon/ingestion${entity ? `?entity=${encodeURIComponent(entity)}` : ""}`)),
  reconDiffs: async (reconId: string, entity?: string): Promise<{ diffs: ReconDiff[] }> =>
    json(
      await fetch(
        `/api/recon/diffs?recon_id=${encodeURIComponent(reconId)}${entity ? `&entity=${encodeURIComponent(entity)}` : ""}`,
      ),
    ),
  evidence: async (id: string): Promise<EvidenceData> => json(await fetch(`/api/specs/${id}/evidence`)),
  features: async (): Promise<{ features: FeatureDef[] }> => json(await fetch("/api/features")),
  featureClick: (id: string): void => {
    void fetch(`/api/features/${id}/click`, { method: "POST" });
  },
};
