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
import { RegistryClient } from "./lib/registry-client.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSpecRoutes } from "./routes/specs.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerBuildRoutes } from "./routes/build.js";

const cfg = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const dbx = new DbxClient();
const registry = new RegistryClient(dbx, cfg.DATABRICKS_WAREHOUSE_ID, cfg.registry);

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
registerBuildRoutes(app, registry, dbx, cfg);

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
  await migrateRegistry(dbx, cfg.DATABRICKS_WAREHOUSE_ID, cfg.registry);
  app.log.info("registry migration complete");
} catch (err) {
  // keep serving; /api/settings/connections will surface the failure
  app.log.error({ err }, "registry migration failed");
}

await app.listen({ host: "0.0.0.0", port: cfg.DATABRICKS_APP_PORT });
