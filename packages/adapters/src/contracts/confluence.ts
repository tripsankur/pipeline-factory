import type { ContractAdapter, ParsedContract } from "./types.js";

/** Coming soon (feature flag `confluence_intake`). Typed skeleton only. */
export class ConfluenceContractAdapter implements ContractAdapter {
  readonly kind = "confluence";

  async parse(): Promise<ParsedContract> {
    throw new Error("Confluence contract intake is coming soon");
  }
}
