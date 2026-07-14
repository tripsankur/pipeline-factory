/**
 * Coming-soon feature flags. Locked features are visible + clickable in the UI
 * (never hidden); clicks log to ctl.feature_events — free roadmap signal.
 */

export interface FeatureDef {
  id: string;
  title: string;
  /** one-line promise shown in the coming-soon panel */
  promise: string;
  /** roadmap bucket shown in the panel */
  roadmap: "next" | "later" | "research";
  available: boolean;
}

export const FEATURES: readonly FeatureDef[] = [
  { id: "fleet", title: "Fleet dashboard", promise: "", roadmap: "next", available: true },
  { id: "intake", title: "Contract intake", promise: "", roadmap: "next", available: true },
  { id: "mapping", title: "Mapping review", promise: "", roadmap: "next", available: true },
  { id: "build", title: "Build & test console", promise: "", roadmap: "next", available: true },
  { id: "evidence", title: "PR evidence", promise: "", roadmap: "next", available: true },
  { id: "history", title: "Spec history & audit", promise: "", roadmap: "next", available: true },
  { id: "settings", title: "Settings", promise: "", roadmap: "next", available: true },

  {
    id: "confluence_intake",
    title: "Confluence intake",
    promise: "Harvest interface contracts directly from Confluence pages and keep them in sync.",
    roadmap: "next",
    available: false,
  },
  {
    id: "kafka_cdc",
    title: "Kafka / CDC transport",
    promise: "Stream ingestion via Kafka topics and CDC feeds as a drop-in transport adapter.",
    roadmap: "next",
    available: false,
  },
  {
    id: "azure_devops",
    title: "Azure DevOps adapter",
    promise: "Branch + PR mechanics on Azure Repos through the same CicdAdapter contract.",
    roadmap: "next",
    available: false,
  },
  {
    id: "gitlab",
    title: "GitLab adapter",
    promise: "Merge-request flow on GitLab through the same CicdAdapter contract.",
    roadmap: "later",
    available: false,
  },
  {
    id: "monitor",
    title: "Monitor module",
    promise: "Prod job runs, recon trends, regression alerts, and a cutover sign-off board.",
    roadmap: "next",
    available: false,
  },
  {
    id: "batch_builds",
    title: "Multi-entity batch builds",
    promise: "Queue a whole interface family and build every entity in one run.",
    roadmap: "later",
    available: false,
  },
  {
    id: "scd2",
    title: "SCD2 ingestion",
    promise: "Slowly-changing-dimension history tracking as an ingestion mode.",
    roadmap: "later",
    available: false,
  },
  {
    id: "dbt_integration",
    title: "dbt integration (silver → gold)",
    promise: "dbt projects consume factory silver as sources; dbt_task rides the same source workflow.",
    roadmap: "later",
    available: false,
  },
  {
    id: "zerobus_nrt",
    title: "Zerobus NRT push (P7)",
    promise: "Producers push events straight into bronze Delta via gRPC — near-real-time without a message bus.",
    roadmap: "later",
    available: false,
  },
  {
    id: "comparison_editor",
    title: "Comparison-spec editor",
    promise: "Per-attribute normalization and tolerance editing for reconciliation.",
    roadmap: "later",
    available: false,
  },
  {
    id: "rbac",
    title: "RBAC roles",
    promise: "Builder / approver / viewer roles enforced across every screen and API.",
    roadmap: "later",
    available: false,
  },
  {
    id: "alerting",
    title: "Alerting & regression detection",
    promise: "Notifications when recon match rates regress between runs.",
    roadmap: "later",
    available: false,
  },
  {
    id: "github_app",
    title: "GitHub App auth",
    promise: "Installation-token auth replacing PATs, with per-repo permissions.",
    roadmap: "research",
    available: false,
  },
  {
    id: "contract_reharvest",
    title: "Scheduled contract re-harvest",
    promise: "Re-pull contracts on a schedule and flag schema drift before it breaks.",
    roadmap: "research",
    available: false,
  },
] as const;

export function featureById(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}
