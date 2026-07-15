import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRenderer, specSourceObject, specToDataflowRow } from "@pf/core";
import { goldenSpec } from "./fixture-spec.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const goldenDir = join(here, "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const render = createRenderer({ templatesDir: join(root, "templates") });
const renderOpts = {
  connectionName: "sfdc_sample",
  batchSchedule: "0 0 3 * * ?",
  frameworkMinVersion: "1.0.0",
  engineGlob: "/Workspace/framework/engine/**",
};

describe("renderer golden files (breaking-change gate, ADR-001/008)", () => {
  const result = render(goldenSpec, renderOpts);

  it("renders metadata files only — never code (ADR-008)", () => {
    expect(result.files.map((f) => f.path)).toEqual([
      "metadata/aldm/contract_account/dataflow.yml",
      "resources/aldm.pipeline.yml",
    ]);
    for (const f of result.files) {
      expect(f.path.endsWith(".yml"), `${f.path} must be declarative metadata`).toBe(true);
    }
  });

  it("is deterministic (same spec -> byte-identical output)", () => {
    const again = render(goldenSpec, renderOpts);
    expect(again.files).toEqual(result.files);
  });

  it("tags every artifact with generated_by + spec identity (constraint #5)", () => {
    for (const f of result.files) {
      expect(f.content, f.path).toContain("generated_by");
      expect(f.content, f.path).toContain(goldenSpec.spec_id);
    }
  });

  it("exposes the dataflow row alongside the files", () => {
    expect(result.row.dataflow_id).toBe(goldenSpec.spec_id);
    expect(result.row.is_active).toBe(true);
  });

  for (const file of result.files) {
    it(`matches golden: ${file.path}`, async () => {
      const goldenPath = join(goldenDir, file.path);
      if (UPDATE || !existsSync(goldenPath)) {
        await mkdir(dirname(goldenPath), { recursive: true });
        await writeFile(goldenPath, file.content, "utf8");
      }
      const expected = (await readFile(goldenPath, "utf8")).replaceAll("\r\n", "\n");
      expect(file.content).toBe(expected);
    });
  }
});

describe("specToDataflowRow (metadata mapping, ADR-008/010)", () => {
  const row = specToDataflowRow(goldenSpec, { connectionName: "sfdc_sample" });

  it("is deterministic", () => {
    expect(specToDataflowRow(goldenSpec, { connectionName: "sfdc_sample" })).toEqual(row);
  });

  it("carries tombstone semantics defaults", () => {
    expect(row.is_active).toBe(true);
    expect(row.framework_min_version).toBe("1.0.0");
  });

  it("selects exactly the spec's source columns", () => {
    expect(row.select_columns).toEqual(goldenSpec.columns.map((c) => c.name));
  });

  it("buckets expectations by action", () => {
    const dq = JSON.parse(row.data_quality_expectations) as Record<string, Record<string, string>>;
    const total =
      Object.keys(dq.expect ?? {}).length +
      Object.keys(dq.expect_or_drop ?? {}).length +
      Object.keys(dq.expect_or_fail ?? {}).length;
    expect(total).toBe(goldenSpec.expectations.length);
  });

  it("derives the source object descriptor", () => {
    const o = specSourceObject(goldenSpec);
    expect(o.include_columns).toEqual(goldenSpec.columns.map((c) => c.name));
    expect(o.primary_keys).toEqual(goldenSpec.primary_keys.map((k) => k.source));
  });
});
