import { randomUUID } from "node:crypto";
import { createLakebasePool } from "@databricks/lakebase";
import type { Pool } from "pg";
import { SpecSchema, type Spec, type SpecStatus } from "@pf/core";
import type { LlmCallMeta } from "@pf/adapters";
import type { BuildRunRow, FleetRow, LlmCallRow, RegistryStore, SpecRow, VersionRow } from "./types.js";

/**
 * Lakebase Postgres store (ADR-007) — the app's operational state, parameterized
 * queries, ms latency. Pool auth (OAuth token refresh) is handled by
 * @databricks/lakebase using the env vars the Apps runtime injects.
 */

const SCHEMA = "pipeline_factory";

export const PG_DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.spec_registry (
    spec_id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    status TEXT NOT NULL,
    current_version INT NOT NULL,
    source_system TEXT,
    target_system TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    approved_by TEXT,
    approved_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.spec_versions (
    spec_id TEXT NOT NULL,
    spec_version INT NOT NULL,
    spec_json JSONB NOT NULL,
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    PRIMARY KEY (spec_id, spec_version)
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.build_runs (
    run_id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    spec_version INT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    fix_iteration INT NOT NULL DEFAULT 0,
    branch TEXT,
    pr_url TEXT,
    detail TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS build_runs_spec_idx ON ${SCHEMA}.build_runs (spec_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.llm_calls (
    call_id TEXT PRIMARY KEY,
    spec_id TEXT,
    purpose TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_chars BIGINT,
    response_chars BIGINT,
    prompt_tokens BIGINT,
    completion_tokens BIGINT,
    latency_ms BIGINT,
    status TEXT NOT NULL,
    prompt_text TEXT,
    response_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.feature_events (
    event_id TEXT PRIMARY KEY,
    feature TEXT NOT NULL,
    user_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.contracts (
    contract_id TEXT NOT NULL,
    contract_version INT NOT NULL,
    name TEXT,
    source_system TEXT,
    schema_source TEXT NOT NULL DEFAULT 'declared',
    contract_yaml TEXT NOT NULL,
    discovered_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    PRIMARY KEY (contract_id, contract_version)
  )`,
];

export class PgStore implements RegistryStore {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? (createLakebasePool() as unknown as Pool);
  }

  async migrate(): Promise<void> {
    for (const stmt of PG_DDL) await this.pool.query(stmt);
  }

  /** One-time backfill from the warehouse store when pg is empty. */
  async backfillFrom(other: RegistryStore): Promise<number> {
    const existing = await this.pool.query(`SELECT COUNT(*) AS n FROM ${SCHEMA}.spec_registry`);
    if (Number(existing.rows[0]?.n ?? 0) > 0) return 0;
    let copied = 0;
    for (const s of await other.listSpecs()) {
      await this.pool.query(
        `INSERT INTO ${SCHEMA}.spec_registry (spec_id, entity, status, current_version, created_by, approved_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now())) ON CONFLICT (spec_id) DO NOTHING`,
        [s.spec_id, s.entity, s.status, s.current_version, s.created_by, s.approved_by, s.updated_at],
      );
      for (const v of await other.listVersions(s.spec_id)) {
        const spec = await other.getSpec(s.spec_id, v.spec_version);
        if (!spec) continue;
        await this.pool.query(
          `INSERT INTO ${SCHEMA}.spec_versions (spec_id, spec_version, spec_json, change_reason, created_at, created_by)
           VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()), $6) ON CONFLICT DO NOTHING`,
          [s.spec_id, v.spec_version, JSON.stringify(spec), v.change_reason, v.created_at, v.created_by],
        );
      }
      for (const b of await other.listBuilds(s.spec_id, 50)) {
        await this.pool.query(
          `INSERT INTO ${SCHEMA}.build_runs (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
           VALUES ($1,$2,$3,'render',$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), $10::timestamptz) ON CONFLICT (run_id) DO NOTHING`,
          [b.run_id, s.spec_id, s.current_version, b.status, b.fix_iteration, b.branch, b.pr_url, b.detail, b.started_at, b.finished_at],
        );
      }
      copied++;
    }
    return copied;
  }

  async insertSpec(spec: Spec, createdBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.spec_registry (spec_id, entity, status, current_version, source_system, target_system, created_by)
       VALUES ($1,$2,'generated',$3,$4,$5,$6)`,
      [spec.spec_id, spec.entity, spec.spec_version, spec.source.system, spec.target.system, createdBy],
    );
    await this.insertVersion(spec, "initial generation", createdBy);
  }

  async insertVersion(spec: Spec, reason: string, createdBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.spec_versions (spec_id, spec_version, spec_json, change_reason, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (spec_id, spec_version) DO UPDATE SET spec_json = EXCLUDED.spec_json, change_reason = EXCLUDED.change_reason`,
      [spec.spec_id, spec.spec_version, JSON.stringify(spec), reason, createdBy],
    );
    await this.pool.query(
      `UPDATE ${SCHEMA}.spec_registry SET current_version = $2, updated_at = now() WHERE spec_id = $1`,
      [spec.spec_id, spec.spec_version],
    );
  }

  async setStatus(specId: string, status: SpecStatus, approvedBy?: string): Promise<void> {
    if (approvedBy) {
      await this.pool.query(
        `UPDATE ${SCHEMA}.spec_registry SET status = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE spec_id = $1`,
        [specId, status, approvedBy],
      );
    } else {
      await this.pool.query(
        `UPDATE ${SCHEMA}.spec_registry SET status = $2, updated_at = now() WHERE spec_id = $1`,
        [specId, status],
      );
    }
  }

  async listSpecs(): Promise<SpecRow[]> {
    const r = await this.pool.query(
      `SELECT spec_id, entity, status, current_version, created_by, approved_by, updated_at::text
       FROM ${SCHEMA}.spec_registry ORDER BY updated_at DESC LIMIT 200`,
    );
    return r.rows.map(rowToSpecRow);
  }

  async getSpec(specId: string, version?: number): Promise<Spec | null> {
    const r =
      version !== undefined
        ? await this.pool.query(
            `SELECT spec_json FROM ${SCHEMA}.spec_versions WHERE spec_id = $1 AND spec_version = $2`,
            [specId, version],
          )
        : await this.pool.query(
            `SELECT spec_json FROM ${SCHEMA}.spec_versions WHERE spec_id = $1 ORDER BY spec_version DESC LIMIT 1`,
            [specId],
          );
    const json = r.rows[0]?.spec_json;
    if (!json) return null;
    return SpecSchema.parse(typeof json === "string" ? JSON.parse(json) : json);
  }

  async getRegistryRow(specId: string): Promise<{ status: string; approved_by: string | null } | null> {
    const r = await this.pool.query(
      `SELECT status, approved_by FROM ${SCHEMA}.spec_registry WHERE spec_id = $1`,
      [specId],
    );
    if (!r.rows[0]) return null;
    return { status: r.rows[0].status, approved_by: r.rows[0].approved_by ?? null };
  }

  async listVersions(specId: string): Promise<VersionRow[]> {
    const r = await this.pool.query(
      `SELECT spec_version, change_reason, created_at::text, created_by
       FROM ${SCHEMA}.spec_versions WHERE spec_id = $1 ORDER BY spec_version DESC`,
      [specId],
    );
    return r.rows.map((x) => ({
      spec_version: Number(x.spec_version),
      change_reason: x.change_reason ?? null,
      created_at: x.created_at ?? null,
      created_by: x.created_by ?? null,
    }));
  }

  async listSpecJson(): Promise<string[]> {
    const r = await this.pool.query(
      `SELECT v.spec_json FROM ${SCHEMA}.spec_registry r
       INNER JOIN ${SCHEMA}.spec_versions v ON v.spec_id = r.spec_id AND v.spec_version = r.current_version
       WHERE r.status != 'draft'`,
    );
    return r.rows.map((x) => (typeof x.spec_json === "string" ? x.spec_json : JSON.stringify(x.spec_json)));
  }

  async fleet(): Promise<FleetRow[]> {
    const r = await this.pool.query(
      `SELECT r.spec_id, r.entity, r.status, r.current_version, r.created_by, r.approved_by, r.updated_at::text,
              v.spec_json, b.status AS build_status, b.pr_url, b.finished_at::text AS build_finished_at
       FROM ${SCHEMA}.spec_registry r
       LEFT JOIN ${SCHEMA}.spec_versions v ON v.spec_id = r.spec_id AND v.spec_version = r.current_version
       LEFT JOIN LATERAL (
         SELECT status, pr_url, finished_at FROM ${SCHEMA}.build_runs
         WHERE spec_id = r.spec_id ORDER BY started_at DESC LIMIT 1
       ) b ON true
       ORDER BY r.updated_at DESC LIMIT 200`,
    );
    return r.rows.map((x) => ({
      ...rowToSpecRow(x),
      spec_json: x.spec_json ? (typeof x.spec_json === "string" ? x.spec_json : JSON.stringify(x.spec_json)) : null,
      build_status: x.build_status ?? null,
      pr_url: x.pr_url ?? null,
      build_finished_at: x.build_finished_at ?? null,
    }));
  }

  async listBuilds(specId: string, limit = 20): Promise<BuildRunRow[]> {
    const r = await this.pool.query(
      `SELECT run_id, status, pr_url, branch, fix_iteration, detail, started_at::text, finished_at::text
       FROM ${SCHEMA}.build_runs WHERE spec_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [specId, limit],
    );
    return r.rows.map((x) => ({
      run_id: x.run_id,
      status: x.status,
      pr_url: x.pr_url ?? null,
      branch: x.branch ?? null,
      fix_iteration: Number(x.fix_iteration ?? 0),
      detail: x.detail ?? null,
      started_at: x.started_at ?? null,
      finished_at: x.finished_at ?? null,
    }));
  }

  async insertBuildRun(run: { runId: string; specId: string; specVersion: number; branch: string; detail: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.build_runs (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, detail)
       VALUES ($1,$2,$3,'render','running',0,$4,$5)`,
      [run.runId, run.specId, run.specVersion, run.branch, run.detail],
    );
  }

  async failBuildRun(runId: string, fixIterations: number, detail: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${SCHEMA}.build_runs SET status = 'failed', fix_iteration = $2, detail = $3, finished_at = now() WHERE run_id = $1`,
      [runId, fixIterations, detail.slice(0, 500)],
    );
  }

  async completeBuildRun(runId: string, fixIterations: number, prUrl: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${SCHEMA}.build_runs SET phase = 'pr_open', status = 'succeeded', fix_iteration = $2, pr_url = $3, finished_at = now() WHERE run_id = $1`,
      [runId, fixIterations, prUrl],
    );
  }

  async failRunningBuildRun(runId: string, detail: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${SCHEMA}.build_runs SET status = 'failed', detail = $2, finished_at = now() WHERE run_id = $1 AND status = 'running'`,
      [runId, detail.slice(0, 500)],
    );
  }

  async logLlmCall(meta: LlmCallMeta, specId: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.llm_calls (call_id, spec_id, purpose, endpoint, request_chars, response_chars,
        prompt_tokens, completion_tokens, latency_ms, status, prompt_text, response_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(),
        specId,
        meta.purpose,
        meta.endpoint,
        meta.requestChars,
        meta.responseChars,
        meta.promptTokens,
        meta.completionTokens,
        meta.latencyMs,
        meta.status,
        meta.requestText,
        meta.responseText,
      ],
    );
  }

  async listLlmCalls(specId: string): Promise<LlmCallRow[]> {
    const r = await this.pool.query(
      `SELECT call_id, spec_id, purpose, endpoint, status, latency_ms, prompt_tokens, completion_tokens,
              prompt_text, response_text, created_at::text
       FROM ${SCHEMA}.llm_calls WHERE spec_id = $1 OR spec_id IS NULL ORDER BY created_at DESC LIMIT 20`,
      [specId],
    );
    return r.rows.map((x) => ({
      call_id: x.call_id,
      spec_id: x.spec_id ?? null,
      purpose: x.purpose,
      endpoint: x.endpoint,
      status: x.status,
      latency_ms: x.latency_ms === null ? null : Number(x.latency_ms),
      prompt_tokens: x.prompt_tokens === null ? null : Number(x.prompt_tokens),
      completion_tokens: x.completion_tokens === null ? null : Number(x.completion_tokens),
      prompt_text: x.prompt_text ?? null,
      response_text: x.response_text ?? null,
      created_at: x.created_at ?? null,
    }));
  }

  async logFeatureEvent(feature: string, userEmail: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.feature_events (event_id, feature, user_email) VALUES ($1,$2,$3)`,
      [randomUUID(), feature, userEmail],
    );
  }

  /** Raw query access for routes that read synced tables (recon dashboard). */
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    return this.pool.query(text, params as never);
  }
}

function rowToSpecRow(x: Record<string, unknown>): SpecRow {
  return {
    spec_id: String(x.spec_id ?? ""),
    entity: String(x.entity ?? ""),
    status: (x.status ?? "draft") as SpecStatus,
    current_version: Number(x.current_version ?? 1),
    created_by: (x.created_by as string | null) ?? null,
    approved_by: (x.approved_by as string | null) ?? null,
    updated_at: (x.updated_at as string | null) ?? null,
  };
}
