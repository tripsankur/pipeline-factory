import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRenderer } from "@pf/core";
import { goldenSpec } from "./fixture-spec.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const goldenDir = join(here, "expected");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const render = createRenderer({ templatesDir: join(root, "templates") });

describe("renderer golden files (breaking-change gate, ADR-001)", () => {
  const result = render(goldenSpec);

  it("renders the full artifact set", () => {
    expect(result.files.map((f) => f.path)).toEqual([
      "pipelines/contract_account/lakeflow_connect.yml",
      "pipelines/contract_account/silver_stitch.sql",
      "pipelines/contract_account/adapter_view.sql",
      "pipelines/contract_account/expectations.yml",
      "pipelines/contract_account/recon_job.py",
      "pipelines/contract_account/tests/test_pipeline.py",
      "pipelines/contract_account/bundle_resource.yml",
    ]);
  });

  it("is deterministic (same spec -> byte-identical output)", () => {
    const again = render(goldenSpec);
    expect(again.files).toEqual(result.files);
  });

  it("tags every artifact with generated_by + spec identity (constraint #5)", () => {
    for (const f of result.files) {
      expect(f.content, f.path).toContain("generated_by");
      expect(f.content, f.path).toContain(goldenSpec.spec_id);
    }
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
