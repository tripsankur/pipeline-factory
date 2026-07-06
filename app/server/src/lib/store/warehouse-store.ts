import { randomUUID } from "node:crypto";
import { fq, SpecSchema, type RegistryConfig, type Spec, type SpecStatus } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { LlmCallMeta } from "@pf/adapters";
import type { BuildRunRow, FleetRow, LlmCallRow, RegistryStore, SpecRow, VersionRow } from "./types.js";

/** SQL-string escaping for literals we control. Specs travel as JSON strings. */
function lit(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/**
 * Warehouse-backed store — the fallback when Lakebase isn't attached
 * (PF_PG_ENABLED=false or PGHOST absent). Same behavior as the original
 * RegistryClient, extended with the build-run and fleet queries so every route
 * works against either backend (ADR-007).
 */
export class WarehouseStore implements RegistryStore {
  readonly kind = "warehouse" as const;

  constructor(
    private readonly dbx: DbxClient,
    private readonly warehouseId: string,
    private readonly cfg: RegistryConfig,
  ) {}

  private t(name: string): string {
    return fq(this.cfg, name);
  }

  async insertSpec(spec: Spec, createdBy: string): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("spec_registry")}
       (spec_id, entity, status, current_version, source_system, target_system, created_at, updated_at, created_by, approved_by, approved_at)
       VALUES (${lit(spec.spec_id)}, ${lit(spec.entity)}, 'generated', ${spec.spec_version},
               ${lit(spec.source.system)}, ${lit(spec.target.system)},
               current_timestamp(), current_timestamp(), ${lit(createdBy)}, NULL, NULL)`,
      this.warehouseId,
    );
    await this.insertVersion(spec, "initial generation", createdBy);
  }

  async insertVersion(spec: Spec, reason: string, createdBy: string): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("spec_versions")}
       (spec_id, spec_version, spec_json, change_reason, created_at, created_by)
       VALUES (${lit(spec.spec_id)}, ${spec.spec_version}, ${lit(JSON.stringify(spec))},
               ${lit(reason)}, current_timestamp(), ${lit(createdBy)})`,
      this.warehouseId,
    );
    await this.dbx.sql(
      `UPDATE ${this.t("spec_registry")}
       SET current_version = ${spec.spec_version}, updated_at = current_timestamp()
       WHERE spec_id = ${lit(spec.spec_id)}`,
      this.warehouseId,
    );
  }

  async setStatus(specId: string, status: SpecStatus, approvedBy?: string): Promise<void> {
    const approval = approvedBy
      ? `, approved_by = ${lit(approvedBy)}, approved_at = current_timestamp()`
      : "";
    await this.dbx.sql(
      `UPDATE ${this.t("spec_registry")}
       SET status = ${lit(status)}, updated_at = current_timestamp()${approval}
       WHERE spec_id = ${lit(specId)}`,
      this.warehouseId,
    );
  }

  async listSpecs(): Promise<SpecRow[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT spec_id, entity, status, current_version, created_by, approved_by, CAST(updated_at AS STRING) AS updated_at
       FROM ${this.t("spec_registry")} ORDER BY updated_at DESC LIMIT 200`,
      this.warehouseId,
    );
    return rows.map((r) => ({
      spec_id: r.spec_id ?? "",
      entity: r.entity ?? "",
      status: (r.status ?? "draft") as SpecStatus,
      current_version: Number(r.current_version ?? 1),
      created_by: r.created_by ?? null,
      approved_by: r.approved_by ?? null,
      updated_at: r.updated_at ?? null,
    }));
  }

  async getSpec(specId: string, version?: number): Promise<Spec | null> {
    const versionClause = version !== undefined ? `AND spec_version = ${version}` : "";
    const rows = await this.dbx.sqlRows(
      `SELECT spec_json FROM ${this.t("spec_versions")}
       WHERE spec_id = ${lit(specId)} ${versionClause}
       ORDER BY spec_version DESC LIMIT 1`,
      this.warehouseId,
    );
    const json = rows[0]?.spec_json;
    if (!json) return null;
    return SpecSchema.parse(JSON.parse(json));
  }

  async getRegistryRow(specId: string): Promise<{ status: string; approved_by: string | null } | null> {
    const rows = await this.dbx.sqlRows(
      `SELECT status, approved_by FROM ${this.t("spec_registry")} WHERE spec_id = ${lit(specId)}`,
      this.warehouseId,
    );
    if (!rows[0]) return null;
    return { status: rows[0].status ?? "", approved_by: rows[0].approved_by ?? null };
  }

  async listVersions(specId: string): Promise<VersionRow[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT spec_version, change_reason, CAST(created_at AS STRING) AS created_at, created_by
       FROM ${this.t("spec_versions")} WHERE spec_id = ${lit(specId)} ORDER BY spec_version DESC`,
      this.warehouseId,
    );
    return rows.map((r) => ({
      spec_version: Number(r.spec_version ?? 0),
      change_reason: r.change_reason ?? null,
      created_at: r.created_at ?? null,
      created_by: r.created_by ?? null,
    }));
  }

  async listSpecJson(): Promise<string[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT v.spec_json
       FROM ${this.t("spec_registry")} r
       INNER JOIN ${this.t("spec_versions")} v
         ON v.spec_id = r.spec_id AND v.spec_version = r.current_version
       WHERE r.status != 'draft'`,
      this.warehouseId,
    );
    return rows.map((r) => r.spec_json ?? "").filter(Boolean);
  }

  async fleet(): Promise<FleetRow[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT r.spec_id, r.entity, r.status, r.current_version, r.created_by, r.approved_by,
              CAST(r.updated_at AS STRING) AS updated_at,
              v.spec_json,
              b.status AS build_status, b.pr_url, CAST(b.finished_at AS STRING) AS build_finished_at
       FROM ${this.t("spec_registry")} r
       LEFT JOIN ${this.t("spec_versions")} v
         ON v.spec_id = r.spec_id AND v.spec_version = r.current_version
       LEFT JOIN (
         SELECT * FROM (
           SELECT spec_id, status, pr_url, finished_at,
                  ROW_NUMBER() OVER (PARTITION BY spec_id ORDER BY started_at DESC) AS rn
           FROM ${this.t("build_runs")}
         ) WHERE rn = 1
       ) b ON b.spec_id = r.spec_id
       ORDER BY r.updated_at DESC LIMIT 200`,
      this.warehouseId,
    );
    return rows.map((r) => ({
      spec_id: r.spec_id ?? "",
      entity: r.entity ?? "",
      status: (r.status ?? "draft") as SpecStatus,
      current_version: Number(r.current_version ?? 1),
      created_by: r.created_by ?? null,
      approved_by: r.approved_by ?? null,
      updated_at: r.updated_at ?? null,
      spec_json: r.spec_json ?? null,
      build_status: r.build_status ?? null,
      pr_url: r.pr_url ?? null,
      build_finished_at: r.build_finished_at ?? null,
    }));
  }

  async listBuilds(specId: string, limit = 20): Promise<BuildRunRow[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT run_id, status, pr_url, branch, fix_iteration, detail,
              CAST(started_at AS STRING) AS started_at, CAST(finished_at AS STRING) AS finished_at
       FROM ${this.t("build_runs")} WHERE spec_id = ${lit(specId)} ORDER BY started_at DESC LIMIT ${limit}`,
      this.warehouseId,
    );
    return rows.map((r) => ({
      run_id: r.run_id ?? "",
      status: r.status ?? "",
      pr_url: r.pr_url ?? null,
      branch: r.branch ?? null,
      fix_iteration: Number(r.fix_iteration ?? 0),
      detail: r.detail ?? null,
      started_at: r.started_at ?? null,
      finished_at: r.finished_at ?? null,
    }));
  }

  async insertBuildRun(run: { runId: string; specId: string; specVersion: number; branch: string; detail: string }): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("build_runs")}
       (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
       VALUES (${lit(run.runId)}, ${lit(run.specId)}, ${run.specVersion}, 'render', 'running', 0,
               ${lit(run.branch)}, NULL, ${lit(run.detail)}, current_timestamp(), NULL)`,
      this.warehouseId,
    );
  }

  async failBuildRun(runId: string, fixIterations: number, detail: string): Promise<void> {
    await this.dbx.sql(
      `UPDATE ${this.t("build_runs")}
       SET status = 'failed', fix_iteration = ${fixIterations}, detail = ${lit(detail.slice(0, 500))}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      this.warehouseId,
    );
  }

  async completeBuildRun(runId: string, fixIterations: number, prUrl: string): Promise<void> {
    await this.dbx.sql(
      `UPDATE ${this.t("build_runs")}
       SET phase = 'pr_open', status = 'succeeded', fix_iteration = ${fixIterations},
           pr_url = ${lit(prUrl)}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      this.warehouseId,
    );
  }

  async failRunningBuildRun(runId: string, detail: string): Promise<void> {
    await this.dbx.sql(
      `UPDATE ${this.t("build_runs")}
       SET status = 'failed', detail = ${lit(detail.slice(0, 500))}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)} AND status = 'running'`,
      this.warehouseId,
    );
  }

  async logLlmCall(meta: LlmCallMeta, specId: string | null): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("llm_calls")}
       (call_id, spec_id, purpose, endpoint, request_chars, response_chars, prompt_tokens, completion_tokens, latency_ms, status, created_at)
       VALUES (${lit(randomUUID())}, ${lit(specId)}, ${lit(meta.purpose)}, ${lit(meta.endpoint)},
               ${meta.requestChars}, ${meta.responseChars},
               ${meta.promptTokens ?? "NULL"}, ${meta.completionTokens ?? "NULL"},
               ${meta.latencyMs}, ${lit(meta.status)}, current_timestamp())`,
      this.warehouseId,
    );
  }

  async listLlmCalls(specId: string): Promise<LlmCallRow[]> {
    const rows = await this.dbx.sqlRows(
      `SELECT call_id, spec_id, purpose, endpoint, status, latency_ms, prompt_tokens, completion_tokens,
              CAST(created_at AS STRING) AS created_at
       FROM ${this.t("llm_calls")} WHERE spec_id = ${lit(specId)} OR spec_id IS NULL
       ORDER BY created_at DESC LIMIT 20`,
      this.warehouseId,
    );
    return rows.map((r) => ({
      call_id: r.call_id ?? "",
      spec_id: r.spec_id ?? null,
      purpose: r.purpose ?? "",
      endpoint: r.endpoint ?? "",
      status: r.status ?? "",
      latency_ms: r.latency_ms === null ? null : Number(r.latency_ms),
      prompt_tokens: r.prompt_tokens === null ? null : Number(r.prompt_tokens),
      completion_tokens: r.completion_tokens === null ? null : Number(r.completion_tokens),
      prompt_text: null, // warehouse llm_calls has no text columns (pg-only feature)
      response_text: null,
      created_at: r.created_at ?? null,
    }));
  }

  async logFeatureEvent(feature: string, userEmail: string): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("feature_events")} (event_id, feature, user_email, created_at)
       VALUES (${lit(randomUUID())}, ${lit(feature)}, ${lit(userEmail)}, current_timestamp())`,
      this.warehouseId,
    );
  }
}
