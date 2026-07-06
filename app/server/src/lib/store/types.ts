import type { Spec, SpecStatus } from "@pf/core";
import type { LlmCallMeta } from "@pf/adapters";

/**
 * RegistryStore — the app's operational-state boundary (ADR-007).
 * Two implementations: PgStore (Lakebase Postgres, ms reads) and
 * WarehouseStore (SQL warehouse fallback so every route works without Lakebase).
 * Data-plane tables (dataflow_spec, staged_artifacts, recon_*) are NOT behind
 * this interface — they stay on Delta for the engine/runners.
 */

export interface SpecRow {
  spec_id: string;
  entity: string;
  status: SpecStatus;
  current_version: number;
  created_by: string | null;
  approved_by: string | null;
  updated_at: string | null;
}

export interface FleetRow extends SpecRow {
  spec_json: string | null;
  build_status: string | null;
  pr_url: string | null;
  build_finished_at: string | null;
}

export interface BuildRunRow {
  run_id: string;
  status: string;
  pr_url: string | null;
  branch: string | null;
  fix_iteration: number;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface VersionRow {
  spec_version: number;
  change_reason: string | null;
  created_at: string | null;
  created_by: string | null;
}

export interface LlmCallRow {
  call_id: string;
  spec_id: string | null;
  purpose: string;
  endpoint: string;
  status: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  prompt_text: string | null;
  response_text: string | null;
  created_at: string | null;
}

export interface RegistryStore {
  readonly kind: "postgres" | "warehouse";

  insertSpec(spec: Spec, createdBy: string): Promise<void>;
  insertVersion(spec: Spec, reason: string, createdBy: string): Promise<void>;
  setStatus(specId: string, status: SpecStatus, approvedBy?: string): Promise<void>;
  listSpecs(): Promise<SpecRow[]>;
  getSpec(specId: string, version?: number): Promise<Spec | null>;
  getRegistryRow(specId: string): Promise<{ status: string; approved_by: string | null } | null>;
  listVersions(specId: string): Promise<VersionRow[]>;
  listSpecJson(): Promise<string[]>; // current-version spec_json for lineage/fleet derivations

  fleet(): Promise<FleetRow[]>;
  listBuilds(specId: string, limit?: number): Promise<BuildRunRow[]>;
  insertBuildRun(run: { runId: string; specId: string; specVersion: number; branch: string; detail: string }): Promise<void>;
  failBuildRun(runId: string, fixIterations: number, detail: string): Promise<void>;
  completeBuildRun(runId: string, fixIterations: number, prUrl: string): Promise<void>;
  failRunningBuildRun(runId: string, detail: string): Promise<void>;

  logLlmCall(meta: LlmCallMeta, specId: string | null): Promise<void>;
  listLlmCalls(specId: string): Promise<LlmCallRow[]>;
  logFeatureEvent(feature: string, userEmail: string): Promise<void>;
}
