import type { Spec } from "@pf/core";

/**
 * Transport adapter boundary. A transport contributes the ingestion fragment
 * of the rendered artifact set (handoff §2 rule 8).
 */
export interface TransportAdapter {
  readonly kind: "lakeflow_connect" | "kafka_cdc";
  /** template name that renders the ingestion artifact for this transport */
  ingestionTemplate(spec: Spec): string;
}

export class LakeflowConnectTransport implements TransportAdapter {
  readonly kind = "lakeflow_connect";
  ingestionTemplate(): string {
    return "lakeflow_connect.yml.njk";
  }
}

/** Coming soon (feature flag `kafka_cdc`). */
export class KafkaCdcTransport implements TransportAdapter {
  readonly kind = "kafka_cdc";
  ingestionTemplate(): string {
    throw new Error("Kafka/CDC transport is coming soon");
  }
}
