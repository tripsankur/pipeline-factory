import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MAIN_NAV, LOCKED_NAV, type NavItem } from "./nav";
import { api } from "./api";
import Fleet from "./pages/Fleet";
import Intake from "./pages/Intake";
import Mapping from "./pages/Mapping";
import Evidence from "./pages/Evidence";
import BuildConsole from "./pages/BuildConsole";
import Lineage from "./pages/Lineage";
import { Reconciliation } from "./pages/Reconciliation";
import History from "./pages/History";
import Settings from "./pages/Settings";
import Docs from "./pages/Docs";
import { Card } from "./components/ui";
import { ToastProvider } from "./components/Toast";

function Icon({ d, color, size = 17 }: { d: string; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d={d} stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState("fleet");
  const [activeSpecId, setActiveSpecId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("light"); // DuBois: light-first
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: api.fleet, refetchInterval: 30_000 });
  const awaitingReview = fleet.data?.kpis.awaiting_review ?? 0;

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  };

  const openLocked = (id: string) => {
    api.featureClick(id);
    setPage(id);
  };

  const navBtn = (item: NavItem, active: boolean, badge?: number) => (
    <button
      key={item.id}
      className="pf-nav-btn"
      onClick={() => (item.locked ? openLocked(item.id) : setPage(item.id))}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "8px 13px",
        border: `1px solid ${active ? "var(--pf-acc-soft)" : "transparent"}`,
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12.4,
        fontFamily: "var(--pf-font-sans)",
        background: active ? "var(--pf-acc-soft)" : "transparent",
        color: active ? "var(--pf-tpri)" : item.locked ? "var(--pf-tmut)" : "var(--pf-tsec)",
        fontWeight: active ? 600 : 500,
      }}
    >
      <Icon d={item.icon} color={active ? "var(--pf-acc)" : item.locked ? "var(--pf-tmut)" : "var(--pf-tsec)"} />
      {item.label}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9.8,
            fontWeight: 700,
            minWidth: 18,
            textAlign: "center",
            padding: "2px 6px",
            borderRadius: 20,
            background: "var(--pf-bad-soft)",
            color: "var(--pf-bad)",
          }}
        >
          {badge}
        </span>
      )}
      {item.locked && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            padding: "2px 7px",
            borderRadius: 20,
            background: "var(--pf-chip)",
            border: "1px solid var(--pf-bd)",
            color: "var(--pf-tmut)",
          }}
        >
          soon
        </span>
      )}
    </button>
  );

  const openSpec = (id: string, target: string) => {
    setActiveSpecId(id);
    setPage(target);
  };

  return (
    <ToastProvider>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <aside
          style={{
            width: 250,
            flexShrink: 0,
            background: "var(--pf-surf)",
            borderRight: "1px solid var(--pf-bd)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "19px 20px 17px",
              borderBottom: "1px solid var(--pf-bd)",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "var(--pf-acc)",
                color: "var(--pf-acc-tx)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 13.2,
              }}
            >
              PF
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12.8 }}>Pipeline Factory</div>
              <div style={{ fontSize: 10.4, color: "var(--pf-tmut)" }}>ingestion builder</div>
            </div>
          </div>

          <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1, overflow: "auto" }}>
            {MAIN_NAV.map((item) => navBtn(item, page === item.id, item.id === "mapping" ? awaitingReview : undefined))}
            <div
              style={{
                margin: "14px 14px 6px",
                fontSize: 9.8,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "var(--pf-tmut)",
              }}
            >
              Coming soon
            </div>
            {LOCKED_NAV.map((item) => navBtn(item, page === item.id))}
          </nav>

          <div style={{ padding: 14, borderTop: "1px solid var(--pf-bd)" }}>
            <button
              onClick={toggleTheme}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 13px",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                background: "transparent",
                color: "var(--pf-tsec)",
                fontSize: 12.1,
                fontFamily: "var(--pf-font-sans)",
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 16,
                  borderRadius: 20,
                  background: theme === "dark" ? "var(--pf-track)" : "var(--pf-acc)",
                  position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: theme === "dark" ? 2 : 16,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: theme === "dark" ? "var(--pf-tsec)" : "#fff",
                    transition: "left 0.2s",
                  }}
                />
              </span>
              {theme === "dark" ? "Dark" : "Light"} mode
            </button>
          </div>
        </aside>

        <main key={page} className="pf-page" style={{ flex: 1, overflow: "auto", padding: 28 }}>
          <h1 style={{ fontSize: 15.5, margin: "0 0 18px" }}>
            {[...MAIN_NAV, ...LOCKED_NAV].find((n) => n.id === page)?.label ?? page.replaceAll("_", " ")}
          </h1>

          {page === "fleet" && <Fleet onOpenSpec={(id) => openSpec(id, "mapping")} />}
          {page === "intake" && <Intake onSpecCreated={(id) => openSpec(id, "mapping")} />}
          {page === "mapping" && <Mapping specId={activeSpecId} onApproved={(id) => openSpec(id, "build")} />}
          {page === "build" && <BuildConsole specId={activeSpecId} />}
          {page === "evidence" && <Evidence specId={activeSpecId} />}
          {page === "lineage" && <Lineage onOpenSpec={(id) => openSpec(id, "mapping")} />}
          {page === "recon" && <Reconciliation />}
          {page === "history" && <History specId={activeSpecId} />}
          {page === "settings" && <Settings />}
          {page === "docs" && <Docs />}
          {LOCKED_NAV.some((n) => n.id === page) && <ComingSoon id={page} />}
        </main>
      </div>
    </ToastProvider>
  );
}

function ComingSoon({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["features"], queryFn: api.features });
  const feature = q.data?.features.find((f) => f.id === id);
  const roadmapLabel = { next: "Up next", later: "Later", research: "Research" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
      <Card style={{ padding: 28 }}>
        <div
          style={{
            display: "inline-block",
            fontSize: 9.8,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--pf-acc)",
            background: "var(--pf-acc-soft)",
            padding: "4px 10px",
            borderRadius: 20,
            marginBottom: 14,
          }}
        >
          Coming soon{feature ? ` · ${roadmapLabel[feature.roadmap]}` : ""}
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 13.2 }}>{feature?.title ?? id.replaceAll("_", " ")}</h2>
        <p style={{ color: "var(--pf-tsec)", fontSize: 12.4, lineHeight: 1.6 }}>
          {feature?.promise ?? "This capability is on the roadmap."}
        </p>
        <p style={{ color: "var(--pf-tmut)", fontSize: 11.2 }}>
          Your click was logged to the roadmap signal — it directly affects prioritization.
        </p>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pf-bd)", fontWeight: 600, fontSize: 12.1 }}>
          Full roadmap
        </div>
        {(q.data?.features ?? [])
          .filter((f) => !f.available)
          .map((f) => (
            <div
              key={f.id}
              style={{
                padding: "9px 16px",
                borderTop: "1px solid var(--pf-bd)",
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                fontSize: 10.8,
              }}
            >
              <span style={{ fontWeight: 600, minWidth: 180 }}>{f.title}</span>
              <span style={{ color: "var(--pf-tsec)", flex: 1 }}>{f.promise}</span>
              <span
                style={{
                  fontSize: 9.8,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: "var(--pf-chip)",
                  color: "var(--pf-tmut)",
                }}
              >
                {roadmapLabel[f.roadmap]}
              </span>
            </div>
          ))}
      </Card>
    </div>
  );
}
