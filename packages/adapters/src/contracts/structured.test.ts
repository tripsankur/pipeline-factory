import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StructuredContractAdapter } from "./structured.js";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, "..", "..", "..", "..", "examples", "aldm.contract.yaml");
const adapter = new StructuredContractAdapter();

describe("Interface Contract v1", () => {
  it("parses the shipped example: whole source, per-table intake entities", async () => {
    const buf = await readFile(examplePath);
    const r = adapter.parse(buf, "aldm.contract.yaml");
    expect(r.contract.contract.id).toBe("IC-ALDM-001");
    expect(Object.keys(r.contract.connectivity)).toEqual(expect.arrayContaining(["dev", "prod"]));
    expect(r.tables).toHaveLength(2);

    const sp = r.tables.find((t) => t.table === "service_point")!;
    expect(sp.mode).toBe("incremental");
    expect(sp.cursorColumn).toBe("updated_ts");
    expect(sp.suggested.sourceEntity).toBe("workspace.bronze.aldm_service_point");
    expect(sp.suggested.targetEntity).toBe("workspace.silver.service_point");
    expect(sp.columns.find((c) => c.name === "address_line")?.description).toContain("PII");
    expect(sp.narrative).toContain("Primary key: service_point_id");
  });

  it("rejects a contract missing prod connectivity", async () => {
    const buf = await readFile(examplePath);
    const broken = buf.toString().replace(/\n  prod:[\s\S]*?change window Sundays 02:00-04:00 UTC\n/, "\n");
    expect(() => adapter.parse(Buffer.from(broken), "x.yaml")).toThrow(/dev.*prod|prod.*environments/i);
  });

  it("rejects a primary key not present in columns", async () => {
    const buf = await readFile(examplePath);
    const broken = buf.toString().replace("primary_key: [account_id]", "primary_key: [nonexistent_col]");
    expect(() => adapter.parse(Buffer.from(broken), "x.yaml")).toThrow(/nonexistent_col/);
  });

  it("rejects incremental tables without cursor_column", async () => {
    const buf = await readFile(examplePath);
    const broken = buf.toString().replace("cursor_column: updated_ts", "cursor_column: null");
    expect(() => adapter.parse(Buffer.from(broken), "x.yaml")).toThrow(/cursor_column/);
  });
});
