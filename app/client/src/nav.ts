/** Sidebar nav model — labels + SVG paths from the Claude Design source. */

/** The guided build workflow: one nav entry, four stepped states. */
export const BUILDER_STEPS = [
  { id: "intake", label: "Contract" },
  { id: "mapping", label: "Mapping" },
  { id: "build", label: "Build & test" },
  { id: "evidence", label: "Evidence & PR" },
] as const;
export const BUILDER_PAGES = BUILDER_STEPS.map((s) => s.id) as readonly string[];

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  locked: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { id: "fleet", label: "Fleet dashboard", icon: "M4 5h7v7H4zM13 5h7v4h-7zM13 13h7v6h-7zM4 15h7v4H4z", locked: false },
  { id: "builder", label: "Pipeline builder", icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5", locked: false },
  { id: "lineage", label: "Lineage", icon: "M5 7a2 2 0 100-4 2 2 0 000 4zM5 21a2 2 0 100-4 2 2 0 000 4zM19 14a2 2 0 100-4 2 2 0 000 4zM7 5h6a4 4 0 014 4v1M7 19h6a4 4 0 004-4v-1", locked: false },
  { id: "recon", label: "Reconciliation", icon: "M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z", locked: false },
  { id: "history", label: "Spec history", icon: "M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z", locked: false },
  { id: "settings", label: "Settings", icon: "M10.325 4.317a1.724 1.724 0 013.35 0 1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572 1.724 1.724 0 010 3.35 1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065 1.724 1.724 0 01-3.35 0 1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572 1.724 1.724 0 010-3.35 1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z", locked: false },
  { id: "docs", label: "Documentation", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253", locked: false },
];

export const LOCKED_NAV: NavItem[] = [
  { id: "monitor", label: "Monitor", icon: "M3 12h4l3 8 4-16 3 8h4", locked: true },
  { id: "kafka_cdc", label: "Kafka / CDC transport", icon: "M7 8a3 3 0 100-6 3 3 0 000 6zm0 14a3 3 0 100-6 3 3 0 000 6zm11-7a3 3 0 100-6 3 3 0 000 6zM9.5 5l6 4M9.5 19l6-4", locked: true },
  { id: "confluence_intake", label: "Confluence intake", icon: "M8 7h8M8 11h8M8 15h5M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z", locked: true },
  { id: "batch_builds", label: "Batch builds", icon: "M4 6h16M4 12h16M4 18h10", locked: true },
  { id: "rbac", label: "RBAC roles", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", locked: true },
];
