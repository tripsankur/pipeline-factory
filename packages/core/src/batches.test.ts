import { describe, expect, it } from "vitest";
import { deriveBatches, batchId, flowName, ingestMode } from "./batches.js";
import { SpecSchema, type Spec } from "./spec.js";

const mk = (entity: string, system: string, mode: "snapshot" | "incremental" | "cdc"): Spec =>
  SpecSchema.parse({
    spec_id: `s-${entity}`,
    spec_version: 1,
    entity,
    source: { system, entity: `workspace.bronze.${system}_${entity}` },
    target: { system: "sf", entity: `workspace.silver.${entity}` },
    ingestion: { transport: "lakeflow_connect", source_object: entity.toUpperCase(), mode, cursor_column: null },
    primary_keys: [{ source: "id", target: "id" }],
    columns: [{ name: "id", target: "id", type: "STRING", confidence: 1, rationale: "" }],
  });

describe("ingestion batches (one batch per source, industry naming)", () => {
  it("groups all batch-mode tables from a source into ONE batch", () => {
    const batches = deriveBatches([
      mk("contract_account", "aldm", "snapshot"),
      mk("service_point", "aldm", "incremental"),
      mk("customer_party", "aldm", "snapshot"),
      mk("orders", "crm", "snapshot"),
    ]);
    expect(batches.map((b) => b.batch_id)).toEqual(["brnz_aldm_batch", "brnz_crm_batch"]);
    expect(batches[0]?.flows).toHaveLength(3);
    expect(batches[1]?.flows).toHaveLength(1);
  });

  it("routes cdc entities to the source's nrt group", () => {
    const batches = deriveBatches([
      mk("contract_account", "aldm", "snapshot"),
      mk("events", "aldm", "cdc"),
    ]);
    expect(batches.map((b) => b.batch_id)).toEqual(["brnz_aldm_batch", "brnz_aldm_nrt"]);
    expect(batches[1]?.mode).toBe("nrt");
  });

  it("follows the flow naming standard brnz_{source}_{entity}_{mode}", () => {
    const spec = mk("contract_account", "aLDM", "snapshot");
    expect(flowName(spec)).toBe("brnz_aldm_contract_account_batch");
    expect(ingestMode(spec)).toBe("batch");
    expect(batchId("aLDM", "nrt")).toBe("brnz_aldm_nrt");
  });
});
