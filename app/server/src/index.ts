import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { DbxClient, TokenProvider, authConfigFromEnv } from "@pf/dbx";
import { FmapiClient } from "@pf/adapters";
import { loadConfig } from "./config.js";
import { migrateRegistry } from "./lib/migrate.js";
import { PgStore } from "./lib/store/pg-store.js";
import { WarehouseStore } from "./lib/store/warehouse-store.js";
import type { RegistryStore } from "./lib/store/types.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSpecRoutes } from "./routes/specs.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerBuildRoutes } from "./routes/build.js";
import { registerFleetRoutes } from "./routes/fleet.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerReconRoutes } from "./routes/recon.js";
import { registerPromptRoutes } from "./routes/prompts.js";

const cfg = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const dbx = new DbxClient();

// ADR-007: Lakebase Postgres is the operational store when attached; the
// warehouse store keeps every route functional without it.
const warehouseStore = new WarehouseStore(dbx, cfg.DATABRICKS_WAREHOUSE_ID, cfg.registry);
let registry: RegistryStore = warehouseStore;
let pgStore: PgStore | null = null;
if (cfg.PF_PG_ENABLED === "true" && cfg.PGHOST) {
  try {
    pgStore = new PgStore();
    await pgStore.migrate();
    const copied = await pgStore.backfillFrom(warehouseStore);
    registry = pgStore;
    app.log.info({ copied }, "lakebase store active (pg migration + backfill complete)");
  } catch (err) {
    app.log.error({ err }, "lakebase store unavailable — falling back to warehouse");
    registry = warehouseStore;
    pgStore = null;
  }
} else {
  app.log.info("lakebase not configured (PGHOST absent or PF_PG_ENABLED != true) — warehouse store");
}

const authCfg = authConfigFromEnv();
const tokens = new TokenProvider(authCfg);
const fmapi = new FmapiClient(
  {
    host: authCfg.host,
    endpoint: cfg.PF_LLM_ENDPOINT,
    apiKeyProvider: () => tokens.getToken(),
  },
  (meta) => registry.logLlmCall(meta, null).catch((err) => app.log.warn({ err }, "llm_calls insert failed")),
);

await app.register(fastifyMultipart, { limits: { fileSize: 15 * 1024 * 1024 } });

registerHealthRoutes(app);
registerSettingsRoutes(app, dbx, cfg);
registerSpecRoutes(app, registry, fmapi, cfg);
registerRenderRoutes(app, registry);
registerBuildRoutes(app, registry, dbx, cfg, fmapi);
registerFleetRoutes(app, registry, dbx, cfg);
registerConnectionRoutes(app, dbx, cfg);
registerReconRoutes(app, dbx, cfg, pgStore);
registerPromptRoutes(app, registry);

// serve built client (dist/public next to the bundled server)
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "public");
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
}

// boot migration — stateless app, registry is source of truth (constraint #6)
try {
  await migrateRegistry(dbx, cfg.DATABRICKS_WAREHOUSE_ID, cfg.registry, cfg.PF_RUNNER_PRINCIPAL);
  app.log.info("registry migration complete");
} catch (err) {
  // keep serving; /api/settings/connections will surface the failure
  app.log.error({ err }, "registry migration failed");
}

await app.listen({ host: "0.0.0.0", port: cfg.DATABRICKS_APP_PORT });
