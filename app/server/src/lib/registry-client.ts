import { randomUUID } from "node:crypto";
import { fq, SpecSchema, type RegistryConfig, type Spec, type SpecStatus } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { LlmCallMeta } from "@pf/adapters";

/** SQL-string escaping for literals we control. Specs travel as JSON strings. */
function lit(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export interface SpecRow {
  spec_id: string;
  entity: string;
  status: SpecStatus;
  current_version: number;
  created_by: string | null;
  approved_by: string | null;
  updated_at: string | null;
}

export class RegistryClient {
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

  async listVersions(specId: string): Promise<{ spec_version: number; change_reason: string | null; created_at: string | null; created_by: string | null }[]> {
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

  async logFeatureEvent(feature: string, userEmail: string): Promise<void> {
    await this.dbx.sql(
      `INSERT INTO ${this.t("feature_events")} (event_id, feature, user_email, created_at)
       VALUES (${lit(randomUUID())}, ${lit(feature)}, ${lit(userEmail)}, current_timestamp())`,
      this.warehouseId,
    );
  }
}
