import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.js";
import { buildEvidenceMarkdown } from "./evidence.js";
import { SpecSchema } from "./spec.js";

const spec = SpecSchema.parse({
  spec_id: "spec-m3",
  spec_version: 2,
  entity: "orders",
  source: { system: "aldm", entity: "c.b.orders_src" },
  target: { system: "sf", entity: "c.s.orders" },
  ingestion: { transport: "lakeflow_connect", source_object: "ORDERS", mode: "snapshot", cursor_column: null },
  crosswalk: { keys: [{ source: "id", target: "sf_id" }], table: "c.s.xw" },
  columns: [
    { name: "id", target: "sf_id", type: "STRING", confidence: 0.95, rationale: "key" },
    { name: "amt", target: "amount", type: "DOUBLE", transform: "CAST(src.`amt` AS DOUBLE)", confidence: 0.6, rationale: "guessed unit" },
  ],
  expectations: [{ name: "id_nn", constraint: "sf_id IS NOT NULL", action: "fail" }],
});

const files = [
  { path: "pipelines/orders/a.sql", content: "select 1\n", sha256: "abc123" },
  { path: "pipelines/orders/b.yml", content: "x: 1\n", sha256: "def456" },
];

describe("buildManifest", () => {
  const manifest = buildManifest(spec, files);

  it("declares version, identity, artifacts with checksums, and both commands", () => {
    expect(manifest).toContain("manifest_version: 2");
    expect(manifest).toContain("artifact_kind: metadata");
    expect(manifest).toContain("spec_id: spec-m3");
    expect(manifest).toContain("spec_version: 2");
    expect(manifest).toContain("- path: pipelines/orders/a.sql");
    expect(manifest).toContain("sha256: abc123");
    expect(manifest).toContain("verify: make verify");
    expect(manifest).toContain("deploy: databricks bundle deploy -t <target>");
    expect(manifest).toContain("location: metadata/aldm/orders/EVIDENCE.md");
  });
});

describe("buildEvidenceMarkdown", () => {
  it("includes mapping table, low-confidence callout, expectations, artifacts", () => {
    const md = buildEvidenceMarkdown({
      spec,
      files,
      approvedBy: "a@b.com",
      buildRunId: "run-1",
      fixIterations: [{ iteration: 1, reason: "cast fix" }],
      recon: { keyMatchRate: 0.999, rowMatchRate: 0.99, attrMatchRate: null },
    });
    expect(md).toContain("| `amt` | `amount` |");
    expect(md).toContain("**1 mapping(s) below 80% confidence**");
    expect(md).toContain("`id_nn`");
    expect(md).toContain("99.90%");
    expect(md).toContain("1. cast fix");
    expect(md).toContain("spec_id: spec-m3");
  });

  it("marks recon as pending when absent", () => {
    const md = buildEvidenceMarkdown({
      spec,
      files,
      approvedBy: null,
      buildRunId: null,
      fixIterations: [],
      recon: null,
    });
    expect(md).toContain("_not yet run");
    expect(md).toContain("_no fixes required_");
  });
});
