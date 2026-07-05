import mammoth from "mammoth";
import type { ContractAdapter, ContractColumn, ParsedContract } from "./types.js";

/**
 * DOCX contract adapter. Extracts raw text via mammoth; table rows that look
 * like `name | type | ...` become columns, everything else becomes narrative
 * context for the LLM.
 */
export class DocxContractAdapter implements ContractAdapter {
  readonly kind = "docx";

  async parse(input: Buffer, filename: string): Promise<ParsedContract> {
    const { value: text } = await mammoth.extractRawText({ buffer: input });
    const entity = filename.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const columns: ContractColumn[] = [];
    const narrative: string[] = [];

    const colLine = /^([A-Za-z_][A-Za-z0-9_ .-]{0,60})\t+([A-Za-z]+[A-Za-z0-9() ,]*)\t*(.*)$/;
    for (const line of lines) {
      const m = colLine.exec(line);
      if (m && m[1] && m[2] && !/^(field|column|attribute|name)$/i.test(m[1].trim())) {
        columns.push({
          name: m[1].trim().replace(/ +/g, "_").toLowerCase(),
          type: m[2].trim(),
          ...(m[3]?.trim() ? { description: m[3].trim() } : {}),
        });
      } else {
        narrative.push(line);
      }
    }

    return {
      entity,
      columns,
      narrative: narrative.join("\n").slice(0, 20_000),
      sourceKind: "docx",
    };
  }
}
