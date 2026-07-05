/** Sidebar nav model — mirrors the Claude Design sidebar. Locked = coming soon. */

export interface NavItem {
  id: string;
  label: string;
  locked: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { id: "fleet", label: "Fleet dashboard", locked: false },
  { id: "intake", label: "Contract intake", locked: false },
  { id: "mapping", label: "Mapping review", locked: false },
  { id: "build", label: "Build & test console", locked: false },
  { id: "evidence", label: "PR evidence", locked: false },
  { id: "history", label: "Spec history", locked: false },
  { id: "settings", label: "Settings", locked: false },
];

export const LOCKED_NAV: NavItem[] = [
  { id: "confluence_intake", label: "Confluence intake", locked: true },
  { id: "kafka_cdc", label: "Kafka / CDC transport", locked: true },
  { id: "monitor", label: "Monitor", locked: true },
  { id: "batch_builds", label: "Batch builds", locked: true },
  { id: "rbac", label: "RBAC roles", locked: true },
];
