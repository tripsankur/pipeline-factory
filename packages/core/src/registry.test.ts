import { describe, expect, it } from "vitest";
import { registryDdl, fq } from "./registry.js";

const cfg = { catalog: "workspace", schema: "ctl" };

describe("registryDdl", () => {
  it("creates schema plus all registry tables (incl. the metadata plane)", () => {
    const ddl = registryDdl(cfg);
    expect(ddl[0]).toContain("CREATE SCHEMA IF NOT EXISTS");
    const tables = [
      "spec_registry",
      "spec_versions",
      "build_runs",
      "recon_runs",
      "recon_entity_result",
      "recon_record_diff",
      "llm_calls",
      "feature_events",
      "staged_artifacts",
      "dataflow_spec",
      "ingestion_runs",
      "watermarks",
      "batch_config",
      "job_config",
      "drift_events",
    ];
    for (const t of tables) {
      expect(ddl.some((s) => s.includes(`\`${t}\``))).toBe(true);
    }
    expect(ddl).toHaveLength(1 + tables.length);
  });

  it("tags every table with generated_by (hard constraint #5)", () => {
    for (const stmt of registryDdl(cfg).slice(1)) {
      expect(stmt).toContain("'generated_by' = 'pipeline_factory'");
    }
  });

  it("is idempotent by construction", () => {
    for (const stmt of registryDdl(cfg)) {
      expect(stmt).toMatch(/IF NOT EXISTS/);
    }
  });

  it("backtick-quotes fully qualified names", () => {
    expect(fq(cfg, "build_runs")).toBe("`workspace`.`ctl`.`build_runs`");
  });
});
