import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { DbxClient } from "@pf/dbx";
import { loadConfig } from "./config.js";
import { migrateRegistry } from "./lib/migrate.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSettingsRoutes } from "./routes/settings.js";

const cfg = loadConfig();
const app = Fastify({ logger: true });
const dbx = new DbxClient();

registerHealthRoutes(app);
registerSettingsRoutes(app, dbx, cfg);

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
