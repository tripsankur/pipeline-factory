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
  const templatesDir = resolveTemplatesDir();
  const render = createRenderer({ templatesDir });

  /** Downloadable Interface Contract template for the in-app docs. */
  app.get("/api/docs/contract-template", async (_req, reply) => {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(templatesDir, "interface_contract.template.yaml"), "utf8");
    return reply
      .header("Content-Type", "text/yaml")
      .header("Content-Disposition", 'attachment; filename="interface_contract.template.yaml"')
      .send(content);
  });

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
