import type { FastifyInstance } from "fastify";
import type { DbxClient } from "@pf/dbx";
import { fq } from "@pf/core";
import type { AppConfig } from "../config.js";

interface ConnectionStatus {
  name: string;
  ok: boolean;
  detail: string;
}

async function check(name: string, fn: () => Promise<string>): Promise<ConnectionStatus> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
}

export function registerSettingsRoutes(app: FastifyInstance, dbx: DbxClient, cfg: AppConfig): void {
  app.get("/api/settings/connections", async () => {
    const checks = await Promise.all([
      check("sql_warehouse", async () => {
        const rows = await dbx.sqlRows("SELECT 1 AS ok", cfg.DATABRICKS_WAREHOUSE_ID);
        return `warehouse ${cfg.DATABRICKS_WAREHOUSE_ID}: query ok (${rows.length} row)`;
      }),
      check("registry", async () => {
        const rows = await dbx.sqlRows(
          `SELECT COUNT(*) AS n FROM ${fq(cfg.registry, "spec_registry")}`,
          cfg.DATABRICKS_WAREHOUSE_ID,
        );
        return `${cfg.registry.catalog}.${cfg.registry.schema}: ${rows[0]?.n ?? "?"} specs`;
      }),
      check("fmapi", async () => {
        const ep = await dbx.servingGet(cfg.PF_LLM_ENDPOINT);
        return `${ep.name}: ${ep.state?.ready ?? "unknown"}`;
      }),
      check("github", async () => {
        if (!cfg.PF_GITHUB_REPO) return "not configured (mock adapter active)";
        return `repo ${cfg.PF_GITHUB_REPO} configured`;
      }),
    ]);
    return { connections: checks };
  });
}
