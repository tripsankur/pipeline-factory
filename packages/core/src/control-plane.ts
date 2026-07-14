import { fq, type RegistryConfig } from "./registry.js";

/**
 * Control plane (ADR-011): batch/job config as first-class tables.
 * Builds SEED rows (INSERT-only — operator edits never clobbered); the
 * provisioner READS them; the app PATCHes them.
 */

export interface BatchConfig {
  source: string;
  schedule_cron: string | null;
  timezone: string;
  enabled: boolean;
  priority: string;
  max_retries: number;
  retry_backoff_seconds: number;
  sla_minutes: number | null;
  notify_emails: string[];
  full_refresh_cron: string | null;
  drift_policy: string;
}

export interface JobConfig {
  source: string;
  timeout_minutes: number | null;
  max_concurrent_runs: number;
  tags: Record<string, string>;
  serverless: boolean;
  channel: string | null;
}

export const BATCH_CONFIG_DEFAULTS: Omit<BatchConfig, "source" | "schedule_cron"> = {
  timezone: "America/New_York",
  enabled: true,
  priority: "normal",
  max_retries: 2,
  retry_backoff_seconds: 300,
  sla_minutes: null,
  notify_emails: [],
  full_refresh_cron: null,
  drift_policy: "warn",
};

export const JOB_CONFIG_DEFAULTS: Omit<JobConfig, "source"> = {
  timeout_minutes: 120,
  max_concurrent_runs: 1,
  tags: {},
  serverless: true,
  channel: null,
};

function s(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function arr(a: string[]): string {
  return a.length === 0 ? "array()" : `array(${a.map((v) => s(v)).join(", ")})`;
}

function map(m: Record<string, string>): string {
  const e = Object.entries(m);
  return e.length === 0 ? "map()" : `map(${e.map(([k, v]) => `${s(k)}, ${s(v)}`).join(", ")})`;
}

/** INSERT-only seed: creates the row with contract defaults iff absent. */
export function batchConfigSeedSql(cfg: RegistryConfig, source: string, scheduleCron: string | null): string {
  const d = BATCH_CONFIG_DEFAULTS;
  return `MERGE INTO ${fq(cfg, "batch_config")} t
USING (SELECT ${s(source)} AS source) x ON t.source = x.source
WHEN NOT MATCHED THEN INSERT
  (source, schedule_cron, timezone, enabled, priority, max_retries, retry_backoff_seconds,
   sla_minutes, notify_emails, full_refresh_cron, drift_policy, updated_at, updated_by)
VALUES (${s(source)}, ${s(scheduleCron)}, ${s(d.timezone)}, ${d.enabled}, ${s(d.priority)},
        ${d.max_retries}, ${d.retry_backoff_seconds}, NULL, ${arr(d.notify_emails)}, NULL,
        ${s(d.drift_policy)}, current_timestamp(), 'pipeline_factory')`;
}

export function jobConfigSeedSql(cfg: RegistryConfig, source: string): string {
  const d = JOB_CONFIG_DEFAULTS;
  return `MERGE INTO ${fq(cfg, "job_config")} t
USING (SELECT ${s(source)} AS source) x ON t.source = x.source
WHEN NOT MATCHED THEN INSERT
  (source, timeout_minutes, max_concurrent_runs, tags, serverless, channel, updated_at, updated_by)
VALUES (${s(source)}, ${d.timeout_minutes}, ${d.max_concurrent_runs}, ${map(d.tags)},
        ${d.serverless}, ${s(d.channel)}, current_timestamp(), 'pipeline_factory')`;
}

export function batchConfigSelectSql(cfg: RegistryConfig, source?: string): string {
  return `SELECT source, schedule_cron, timezone, enabled, priority, max_retries,
       retry_backoff_seconds, sla_minutes, notify_emails, full_refresh_cron, drift_policy,
       CAST(updated_at AS STRING) AS updated_at, updated_by
FROM ${fq(cfg, "batch_config")}${source ? ` WHERE source = ${s(source)}` : ""}`;
}

export function jobConfigSelectSql(cfg: RegistryConfig, source: string): string {
  return `SELECT source, timeout_minutes, max_concurrent_runs, tags, serverless, channel
FROM ${fq(cfg, "job_config")} WHERE source = ${s(source)}`;
}

/** Operator PATCH — only whitelisted fields, only provided ones. */
export function batchConfigUpdateSql(
  cfg: RegistryConfig,
  source: string,
  patch: Partial<Pick<BatchConfig, "schedule_cron" | "timezone" | "enabled" | "priority" | "max_retries" | "retry_backoff_seconds" | "sla_minutes" | "notify_emails" | "full_refresh_cron" | "drift_policy">>,
  updatedBy: string,
): string | null {
  const sets: string[] = [];
  if (patch.schedule_cron !== undefined) sets.push(`schedule_cron = ${s(patch.schedule_cron)}`);
  if (patch.timezone !== undefined) sets.push(`timezone = ${s(patch.timezone)}`);
  if (patch.enabled !== undefined) sets.push(`enabled = ${patch.enabled}`);
  if (patch.priority !== undefined) sets.push(`priority = ${s(patch.priority)}`);
  if (patch.max_retries !== undefined) sets.push(`max_retries = ${patch.max_retries}`);
  if (patch.retry_backoff_seconds !== undefined) sets.push(`retry_backoff_seconds = ${patch.retry_backoff_seconds}`);
  if (patch.sla_minutes !== undefined) sets.push(`sla_minutes = ${patch.sla_minutes === null ? "NULL" : patch.sla_minutes}`);
  if (patch.notify_emails !== undefined) sets.push(`notify_emails = ${arr(patch.notify_emails)}`);
  if (patch.full_refresh_cron !== undefined) sets.push(`full_refresh_cron = ${s(patch.full_refresh_cron)}`);
  if (patch.drift_policy !== undefined) sets.push(`drift_policy = ${s(patch.drift_policy)}`);
  if (sets.length === 0) return null;
  sets.push(`updated_at = current_timestamp()`, `updated_by = ${s(updatedBy)}`);
  return `UPDATE ${fq(cfg, "batch_config")} SET ${sets.join(", ")} WHERE source = ${s(source)}`;
}

/** Parse a warehouse row (strings/JSON-ish) into a typed BatchConfig. */
export function parseBatchConfigRow(r: Record<string, string | null>): BatchConfig {
  let emails: string[] = [];
  try {
    const v = r.notify_emails;
    if (v) emails = JSON.parse(v) as string[];
  } catch {
    emails = [];
  }
  return {
    source: r.source ?? "",
    schedule_cron: r.schedule_cron ?? null,
    timezone: r.timezone ?? BATCH_CONFIG_DEFAULTS.timezone,
    enabled: String(r.enabled) === "true",
    priority: r.priority ?? "normal",
    max_retries: Number(r.max_retries ?? BATCH_CONFIG_DEFAULTS.max_retries),
    retry_backoff_seconds: Number(r.retry_backoff_seconds ?? BATCH_CONFIG_DEFAULTS.retry_backoff_seconds),
    sla_minutes: r.sla_minutes === null || r.sla_minutes === undefined ? null : Number(r.sla_minutes),
    notify_emails: emails,
    full_refresh_cron: r.full_refresh_cron ?? null,
    drift_policy: r.drift_policy ?? "warn",
  };
}

export function parseJobConfigRow(r: Record<string, string | null> | undefined): JobConfig {
  if (!r) return { source: "", ...JOB_CONFIG_DEFAULTS };
  let tags: Record<string, string> = {};
  try {
    if (r.tags) tags = JSON.parse(r.tags) as Record<string, string>;
  } catch {
    tags = {};
  }
  return {
    source: r.source ?? "",
    timeout_minutes: r.timeout_minutes === null || r.timeout_minutes === undefined ? JOB_CONFIG_DEFAULTS.timeout_minutes : Number(r.timeout_minutes),
    max_concurrent_runs: Number(r.max_concurrent_runs ?? 1),
    tags,
    serverless: r.serverless === null || r.serverless === undefined ? true : String(r.serverless) === "true",
    channel: r.channel ?? null,
  };
}
