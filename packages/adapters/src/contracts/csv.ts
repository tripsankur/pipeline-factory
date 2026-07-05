import Papa from "papaparse";
import type { ContractAdapter, ContractColumn, ParsedContract } from "./types.js";

/**
 * CSV contract adapter. Two shapes supported:
 * 1. Schema listing: rows describe columns (has a name-ish column + type-ish column).
 * 2. Data sample: header row is the schema; first data row becomes samples.
 */
export class CsvContractAdapter implements ContractAdapter {
  readonly kind = "csv";

  async parse(input: Buffer, filename: string): Promise<ParsedContract> {
    const text = input.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(text.trim(), {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`CSV parse failed: ${parsed.errors[0]?.message}`);
    }
    const headers = parsed.meta.fields ?? [];
    const entity = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

    const nameHeader = headers.find((h) => /^(field|column|attribute)([ _]?name)?$/i.test(h.trim()));
    const typeHeader = headers.find((h) => /type/i.test(h.trim()));

    let columns: ContractColumn[];
    if (nameHeader) {
      // shape 1: schema listing
      const descHeader = headers.find((h) => /desc|comment|note/i.test(h.trim()));
      const nullHeader = headers.find((h) => /null|optional|required/i.test(h.trim()));
      columns = parsed.data.map((row) => ({
        name: (row[nameHeader] ?? "").trim(),
        type: typeHeader ? row[typeHeader]?.trim() : undefined,
        description: descHeader ? row[descHeader]?.trim() : undefined,
        nullable: nullHeader ? !/^(n|no|false|required)$/i.test((row[nullHeader] ?? "").trim()) : undefined,
      })).filter((c) => c.name.length > 0);
    } else {
      // shape 2: data sample
      const first = parsed.data[0] ?? {};
      columns = headers.map((h) => {
        const sample = first[h]?.trim();
        return { name: h.trim(), ...(sample !== undefined && sample !== "" ? { sample } : {}) };
      });
    }

    if (columns.length === 0) throw new Error("No columns found in CSV contract");
    return { entity, columns, narrative: "", sourceKind: "csv" };
  }
}
