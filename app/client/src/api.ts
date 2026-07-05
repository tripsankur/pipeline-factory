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
  crosswalk: { keys: { source: string; target: string }[]; table: string };
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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  parseContract: async (file: File): Promise<{ contract: ParsedContract }> => {
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
    crosswalkTable: string;
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
  ): Promise<{ run_id: string; branch: string; pr: { url: string; number: number }; adapter: string; files: string[] }> =>
    json(await fetch(`/api/specs/${id}/build`, { method: "POST" })),
  featureClick: (id: string): void => {
    void fetch(`/api/features/${id}/click`, { method: "POST" });
  },
};
