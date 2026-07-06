import { parse as parseYaml } from "yaml";
import { InterfaceContractSchema, type InterfaceContract, type ContractTable } from "@pf/core";
import type { ContractColumn, ParsedContract } from "./types.js";

/**
 * Structured Interface Contract v1 adapter (.yaml/.yml/.json).
 * One contract file describes a whole source; each table becomes an intake
 * entity carrying full connectivity + schema context for the build.
 */

export interface StructuredParseResult {
  contract: InterfaceContract;
  tables: ParsedTableContract[];
}

export interface ParsedTableContract extends ParsedContract {
  table: string;
  mode: "snapshot" | "incremental" | "cdc";
  cursorColumn: string | null;
  primaryKey: string[];
  suggested: {
    sourceEntity: string;
    targetEntity: string;
    crosswalkTable: string;
    sourceSystem: string;
    targetSystem: string;
  };
}

export class StructuredContractAdapter {
  readonly kind = "structured" as const;

  /** Throws zod errors with paths — surfaced verbatim to the uploader. */
  parse(input: Buffer, filename: string): StructuredParseResult {
    const text = input.toString("utf8");
    const raw: unknown = filename.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    const contract = InterfaceContractSchema.parse(raw);

    const tables = contract.tables.map((t) => this.toParsed(contract, t));
    return { contract, tables };
  }

  private toParsed(c: InterfaceContract, t: ContractTable): ParsedTableContract {
    const columns: ContractColumn[] = t.columns.map((col) => ({
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      description: [
        col.description,
        col.pii ? "PII" : "",
        col.enum_values.length > 0 ? `enum(${col.enum_values.join("|")})` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      ...(col.sample !== null ? { sample: col.sample } : {}),
    }));

    const narrative = [
      `Interface contract ${c.contract.id} v${c.contract.version} (${c.contract.name}).`,
      `Source system: ${c.source.system} (${c.source.kind}), owner ${c.source.owner_team}.`,
      `Table ${t.name}: ${t.description || "no description"}.`,
      `Primary key: ${t.primary_key.join(", ")}.`,
      t.expected_daily_rows !== null ? `Expected volume: ~${t.expected_daily_rows} rows/day.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const cat = c.target.catalog;
    return {
      entity: t.name,
      columns,
      narrative,
      sourceKind: "csv", // reuses the ParsedContract wire shape; kind refined below
      table: t.name,
      mode: t.mode ?? c.ingestion.default_mode,
      cursorColumn: t.cursor_column,
      primaryKey: t.primary_key,
      suggested: {
        sourceEntity: `${cat}.${c.target.bronze_schema}.${c.source.system}_${t.name}`,
        targetEntity: `${cat}.${c.target.silver_schema}.${t.name}`,
        crosswalkTable: `${cat}.${c.target.silver_schema}.crosswalk_${t.name}`,
        sourceSystem: c.source.system,
        targetSystem: c.target.system || "target",
      },
    };
  }
}
