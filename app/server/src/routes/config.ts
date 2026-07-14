import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  batchConfigSelectSql,
  batchConfigUpdateSql,
  parseBatchConfigRow,
} from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { AppConfig } from "../config.js";

/**
 * Control-plane API (ADR-011): batch config is operator-editable without a
 * rebuild. Schedule / pause / notifications apply to the live workflow
 * immediately via a partial jobs update; retry policy applies on next build
 * (task-level settings need a full re-provision).
 */

const PatchBody = z
  .object({
    schedule_cron: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    max_retries: z.number().int().min(0).max(10).optional(),
    retry_backoff_seconds: z.number().int().min(0).optional(),
    sla_minutes: z.number().int().min(1).nullable().optional(),
    notify_emails: z.array(z.string().email()).max(20).optional(),
    full_refresh_cron: z.string().min(1).nullable().optional(),
  })
  .strict();

export function registerConfigRoutes(app: FastifyInstance, dbx: DbxClient, cfg: AppConfig): void {
  app.get("/api/config/batches", async () => {
    const rows = await dbx.sqlRows(batchConfigSelectSql(cfg.registry), cfg.DATABRICKS_WAREHOUSE_ID);
    return { batches: rows.map(parseBatchConfigRow) };
  });

  app.get("/api/config/batches/:source", async (req, reply) => {
    const { source } = req.params as { source: string };
    const rows = await dbx.sqlRows(
      batchConfigSelectSql(cfg.registry, source),
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    if (!rows[0]) return reply.code(404).send({ error: `no batch_config for source '${source}'` });
    return { batch: parseBatchConfigRow(rows[0]) };
  });

  app.patch("/api/config/batches/:source", async (req, reply) => {
    const { source } = req.params as { source: string };
    const body = PatchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body", detail: body.error.issues });

    const user =
      (req.headers["x-forwarded-email"] as string) || cfg.PF_DEV_USER_EMAIL || "operator";
    // strip undefined keys (exactOptionalPropertyTypes)
    const patch = Object.fromEntries(
      Object.entries(body.data).filter(([, v]) => v !== undefined),
    ) as Parameters<typeof batchConfigUpdateSql>[2];
    const sql = batchConfigUpdateSql(cfg.registry, source, patch, user);
    if (!sql) return reply.code(400).send({ error: "empty patch" });
    await dbx.sql(sql, cfg.DATABRICKS_WAREHOUSE_ID);

    const rows = await dbx.sqlRows(batchConfigSelectSql(cfg.registry, source), cfg.DATABRICKS_WAREHOUSE_ID);
    const batch = parseBatchConfigRow(rows[0] ?? {});

    // apply live-appliable settings to the existing workflow immediately
    let applied = "config only (no workflow found)";
    const r = await dbx.jobsList(`${source}_workflow`);
    const job = (r.jobs ?? []).find((j) => j.settings?.name === `${source}_workflow`);
    if (job) {
      const newSettings: Record<string, unknown> = {
        ...(batch.schedule_cron
          ? {
              schedule: {
                quartz_cron_expression: batch.schedule_cron,
                timezone_id: batch.timezone,
                pause_status: batch.enabled ? "UNPAUSED" : "PAUSED",
              },
            }
          : {}),
        ...(batch.notify_emails.length > 0
          ? { email_notifications: { on_failure: batch.notify_emails } }
          : {}),
      };
      if (Object.keys(newSettings).length > 0) {
        await dbx.jobUpdate(job.job_id, newSettings);
        applied = `workflow ${job.job_id} updated live (schedule/pause/notifications); retry policy applies on next build`;
      }
    }
    return { batch, applied };
  });
}
