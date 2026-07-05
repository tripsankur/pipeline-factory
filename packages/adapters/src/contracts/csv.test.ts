import { describe, expect, it } from "vitest";
import { CsvContractAdapter } from "./csv.js";

const adapter = new CsvContractAdapter();

describe("CsvContractAdapter", () => {
  it("parses a schema-listing CSV", async () => {
    const csv = [
      "Field Name,Data Type,Description,Nullable",
      "account_id,VARCHAR(18),Primary account identifier,No",
      "status_cd,CHAR(1),Account status code,Yes",
    ].join("\n");
    const r = await adapter.parse(Buffer.from(csv), "Contract Account.csv");
    expect(r.entity).toBe("contract_account");
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({
      name: "account_id",
      type: "VARCHAR(18)",
      nullable: false,
    });
    expect(r.columns[1]?.nullable).toBe(true);
  });

  it("parses a data-sample CSV via headers", async () => {
    const csv = ["account_id,status_cd,balance", "ACC-1,A,120.55"].join("\n");
    const r = await adapter.parse(Buffer.from(csv), "sample.csv");
    expect(r.columns.map((c) => c.name)).toEqual(["account_id", "status_cd", "balance"]);
    expect(r.columns[2]?.sample).toBe("120.55");
  });

  it("throws on empty input", async () => {
    await expect(adapter.parse(Buffer.from(""), "x.csv")).rejects.toThrow();
  });
});
