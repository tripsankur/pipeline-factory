import nunjucks from "nunjucks";
import { createHash } from "node:crypto";
import { batchId, flowName, ingestMode } from "./batches.js";
import type { Spec } from "./spec.js";

/**
 * The renderer — sole producer of files (hard constraint #1, ADR-001).
 * Pure function: (spec) -> files[]. Same spec in, byte-identical files out;
 * golden tests enforce this.
 */

export interface RenderedFile {
  path: string;
  content: string;
  sha256: string;
}

export interface RenderResult {
  files: RenderedFile[];
  spec: Spec;
}

const TEMPLATES: { template: string; out: (s: Spec) => string }[] = [
  { template: "lakeflow_connect.yml.njk", out: (s) => `pipelines/${s.entity}/lakeflow_connect.yml` },
  { template: "silver_stitch.sql.njk", out: (s) => `pipelines/${s.entity}/silver_stitch.sql` },
  { template: "adapter_view.sql.njk", out: (s) => `pipelines/${s.entity}/adapter_view.sql` },
  { template: "expectations.yml.njk", out: (s) => `pipelines/${s.entity}/expectations.yml` },
  { template: "recon_job.py.njk", out: (s) => `pipelines/${s.entity}/recon_job.py` },
  { template: "test_pipeline.py.njk", out: (s) => `pipelines/${s.entity}/tests/test_pipeline.py` },
  { template: "bundle_resource.yml.njk", out: (s) => `pipelines/${s.entity}/bundle_resource.yml` },
];

export interface RendererOptions {
  templatesDir: string;
}

export function createRenderer(opts: RendererOptions) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(opts.templatesDir), {
    autoescape: false,
    throwOnUndefined: true,
    trimBlocks: true,
    lstripBlocks: true,
  });

  env.addFilter("sqlIdent", (v: string) => `\`${String(v).replaceAll("`", "")}\``);
  env.addFilter("pyStr", (v: string) => JSON.stringify(String(v)));

  return function render(spec: Spec): RenderResult {
    const mode = ingestMode(spec);
    const ctx = {
      spec,
      ingest: {
        mode,
        batch: batchId(spec.source.system, mode),
        flow: flowName(spec),
      },
      tag: {
        generated_by: "pipeline_factory",
        spec_id: spec.spec_id,
        spec_version: spec.spec_version,
      },
    };
    const files = TEMPLATES.map(({ template, out }) => {
      const content = normalize(env.render(template, ctx));
      return { path: out(spec), content, sha256: sha256(content) };
    });
    return { files, spec };
  };
}

/** LF endings + exactly one trailing newline — byte-stable across platforms. */
function normalize(s: string): string {
  return s.replaceAll("\r\n", "\n").replace(/\n*$/, "\n");
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Commit message for rendered artifacts (constraint #5 tagging). */
export function commitMessage(spec: Spec): string {
  return [
    `feat(${spec.entity}): rendered pipeline artifacts`,
    "",
    `generated_by: pipeline_factory`,
    `spec_id: ${spec.spec_id}`,
    `spec_version: ${spec.spec_version}`,
  ].join("\n");
}

/** Branch name for a spec build. */
export function branchName(spec: Spec): string {
  return `feat/${spec.entity}-ingestion-v${spec.spec_version}`;
}
