import { describe, expect, it } from "vitest";
import { SpecSchema, SpecDeltaSchema, applyDelta, type Spec } from "./spec.js";

const validSpec: Spec = SpecSchema.parse({
  spec_id: "spec-001",
  spec_version: 1,
  entity: "contract_account",
  source: { system: "aldm", entity: "bronze.aldm.contract_account" },
  target: { system: "salesforce_comms", entity: "silver.galileo.contract_account" },
  ingestion: {
    transport: "lakeflow_connect",
    source_object: "CONTRACT_ACCOUNT",
    mode: "snapshot",
    cursor_column: null,
  },
  crosswalk: {
    keys: [{ source: "account_id", target: "sf_account_id" }],
    table: "silver.galileo.crosswalk_account",
  },
  columns: [
    {
      name: "account_id",
      target: "sf_account_id",
      type: "STRING",
      transform: null,
      value_map: [],
      confidence: 0.98,
      rationale: "exact name match via crosswalk",
      compare: { enabled: true, normalize: null, tolerance: null },
    },
    {
      name: "status_cd",
      target: "status",
      type: "STRING",
      transform: "CASE WHEN status_cd = 'A' THEN 'Active' ELSE 'Inactive' END",
      value_map: [
        { from: "A", to: "Active" },
        { from: "I", to: "Inactive" },
      ],
      confidence: 0.71,
      rationale: "enumeration inferred from contract notes",
      compare: { enabled: true, normalize: "UPPER(value)", tolerance: null },
    },
  ],
  expectations: [
    { name: "account_id_not_null", constraint: "account_id IS NOT NULL", action: "fail" },
  ],
  evidence: {},
});

describe("SpecSchema", () => {
  it("accepts a valid spec", () => {
    expect(validSpec.spec_id).toBe("spec-001");
    expect(validSpec.columns).toHaveLength(2);
  });

  it("rejects a spec with no columns", () => {
    expect(() => SpecSchema.parse({ ...validSpec, columns: [] })).toThrow();
  });

  it("rejects out-of-range confidence", () => {
    const bad = structuredClone(validSpec) as Record<string, unknown>;
    (bad.columns as { confidence: number }[])[0]!.confidence = 1.5;
    expect(() => SpecSchema.parse(bad)).toThrow();
  });

  it("defaults transform to null and value_map to empty", () => {
    const s = SpecSchema.parse({
      ...validSpec,
      columns: [
        {
          name: "x",
          target: "y",
          type: "STRING",
          confidence: 0.5,
        },
      ],
    });
    expect(s.columns[0]?.transform).toBeNull();
    expect(s.columns[0]?.value_map).toEqual([]);
    expect(s.columns[0]?.compare.enabled).toBe(true);
  });
});

describe("applyDelta", () => {
  it("replaces matched columns, bumps version, records reason", () => {
    const delta = SpecDeltaSchema.parse({
      reason: "recon mismatch on status normalization",
      columns: [
        {
          name: "status_cd",
          target: "status",
          type: "STRING",
          transform: "INITCAP(status_cd)",
          confidence: 0.8,
          rationale: "fix loop iteration 1",
        },
      ],
    });
    const next = applyDelta(validSpec, delta);
    expect(next.spec_version).toBe(2);
    expect(next.columns.find((c) => c.name === "status_cd")?.transform).toBe("INITCAP(status_cd)");
    // untouched column preserved
    expect(next.columns.find((c) => c.name === "account_id")?.confidence).toBe(0.98);
    expect(next.evidence["fix_v2"]).toContain("recon mismatch");
    // original untouched (pure)
    expect(validSpec.spec_version).toBe(1);
  });

  it("appends new expectations and replaces matched ones", () => {
    const delta = SpecDeltaSchema.parse({
      reason: "add null guard",
      expectations: [
        { name: "status_not_null", constraint: "status IS NOT NULL", action: "warn" },
      ],
    });
    const next = applyDelta(validSpec, delta);
    expect(next.expectations).toHaveLength(2);
  });
});
