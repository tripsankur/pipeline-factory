/**
 * Build the self-contained Databricks Apps deploy artifact into app/deploy/.
 * No npm install happens at app startup: the server (with all workspace deps
 * inlined) ships as one bundled file + the built client + templates.
 *
 * Prereqs: `pnpm exec tsc -b` and `pnpm --filter @pf/client build` already run.
 */
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const deployDir = join(root, "app", "deploy");
const distDir = join(deployDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(root, "app", "server", "src", "index.ts")],
  outfile: join(distDir, "server.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  minify: false,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

const clientDist = join(root, "app", "client", "dist");
if (!existsSync(clientDist)) {
  throw new Error("client not built — run: pnpm --filter @pf/client build");
}
await cp(clientDist, join(distDir, "public"), { recursive: true });

const templatesDir = join(root, "templates");
if (existsSync(templatesDir)) {
  await cp(templatesDir, join(deployDir, "templates"), { recursive: true });
}

await writeFile(
  join(deployDir, "package.json"),
  JSON.stringify({ name: "pipeline-factory-app", version: "0.1.0", type: "module" }, null, 2) + "\n",
  "utf8",
);

// size guard: Databricks Apps source limit is 10 MB
async function dirSize(p) {
  let total = 0;
  for (const e of await readdir(p, { withFileTypes: true })) {
    const fp = join(p, e.name);
    total += e.isDirectory() ? await dirSize(fp) : (await stat(fp)).size;
  }
  return total;
}
const mb = (await dirSize(deployDir)) / 1024 / 1024;
console.log(`deploy artifact: ${mb.toFixed(2)} MB`);
if (mb > 9.5) throw new Error(`deploy artifact ${mb.toFixed(2)} MB exceeds the 10 MB Apps limit`);
