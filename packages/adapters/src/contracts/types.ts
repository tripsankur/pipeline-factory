/** Contract-source adapter boundary (handoff §2 rule 8). */

export interface ContractColumn {
  name: string;
  type?: string | undefined;
  nullable?: boolean | undefined;
  description?: string | undefined;
  sample?: string | undefined;
}

export interface ParsedContract {
  /** best-guess entity name (from filename or doc title) */
  entity: string;
  columns: ContractColumn[];
  /** free text surrounding the schema — given to the LLM as context */
  narrative: string;
  sourceKind: "csv" | "docx" | "confluence";
}

export interface ContractAdapter {
  readonly kind: ParsedContract["sourceKind"];
  parse(input: Buffer, filename: string): Promise<ParsedContract>;
}
