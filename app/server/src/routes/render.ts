import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { createRenderer, branchName, commitMessage } from "@pf/core";
import type { RegistryClient } from "../lib/registry-client.js";

/** Resolve templates dir: bundled deploy layout first, then repo layout (local dev). */
export function resolveTemplatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "templates"), // app/deploy/dist -> app/deploy/templates
    join(here, "..", "..", "..", "..", "templates"), // app/server/src/routes -> repo/templates
    join(here, "..", "..", "..", "templates"),
  ];
  const found = candidates.find((c) => existsSync(join(c, "silver_stitch.sql.njk")));
  if (!found) throw new Error(`templates dir not found; tried: ${candidates.join(", ")}`);
  return found;
}

export function registerRenderRoutes(app: FastifyInstance, registry: RegistryClient): void {
  const render = createRenderer({ templatesDir: resolveTemplatesDir() });

  /** W2: render artifacts from the latest approved spec version (preview + build input). */
  app.get("/api/specs/:id/artifacts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await registry.getSpec(id);
    if (!spec) return reply.code(404).send({ error: "spec not found" });
    const result = render(spec);
    return {
      branch: branchName(spec),
      commit_message: commitMessage(spec),
      files: result.files,
    };
  });
}
