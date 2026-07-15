import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MAIN_NAV, LOCKED_NAV, BUILDER_STEPS, BUILDER_PAGES, type NavItem } from "./nav";
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
      onClick={() => (item.locked ? openLocked(item.id) : setPage(item.id === "builder" ? "intake" : item.id))}
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
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <header className="pf-ribbon">
          <div className="pf-ribbon-brand">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-label="Pipeline Factory">
              <rect width="26" height="26" rx="6" fill="#2272B4"/>
              <path d="M6 8.5h14M6 13h10M6 17.5h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="20" cy="13" r="2.6" fill="#FCA311"/>
            </svg>
            <span style={{ fontWeight: 600 }}>Pipeline Factory</span>
            <span className="pf-ribbon-crumb">/ {BUILDER_PAGES.includes(page) ? "Pipeline builder" : ([...MAIN_NAV, ...LOCKED_NAV].find((n) => n.id === page)?.label ?? page)}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <UserChip />
          </div>
        </header>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <aside
          className="pf-sidenav"
          style={{
            width: 232,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1, overflow: "auto" }}>
            {MAIN_NAV.map((item) => navBtn(item, item.id === "builder" ? BUILDER_PAGES.includes(page) : page === item.id, item.id === "builder" ? awaitingReview : undefined))}
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
          {BUILDER_PAGES.includes(page) ? (
            <BuilderStepper page={page} specId={activeSpecId} onNav={setPage} />
          ) : (
            <h1 style={{ fontSize: 15.5, margin: "0 0 18px" }}>
              {[...MAIN_NAV, ...LOCKED_NAV].find((n) => n.id === page)?.label ?? page.replaceAll("_", " ")}
            </h1>
          )}

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


function UserChip() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/me");
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { email: string; workspace_url: string };
    },
    staleTime: Infinity,
  });
  if (!q.data) return null;
  const initials = q.data.email.slice(0, 2).toUpperCase();
  return (
    <span className="pf-userchip" title={`Signed in as ${q.data.email}`}>
      <span className="pf-avatar">{initials}</span>
      {q.data.email}
      <a
        href={q.data.workspace_url}
        target="_blank"
        rel="noreferrer"
        title="Open the Databricks workspace"
        style={{ color: "var(--pf-acc)", textDecoration: "none", fontWeight: 600 }}
      >
        workspace {"↗"}
      </a>
    </span>
  );
}


/** The build path as a stateful workflow: Contract -> Mapping -> Build -> Evidence.
 *  Step states derive from the active spec's lifecycle status. */
function BuilderStepper({ page, specId, onNav }: { page: string; specId: string | null; onNav: (p: string) => void }) {
  const specs = useQuery({
    queryKey: ["specs-stepper"],
    queryFn: async () => {
      const r = await fetch("/api/specs");
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as { specs: { spec_id: string; status: string; entity: string }[] };
    },
    refetchInterval: 15_000,
  });
  const spec = specs.data?.specs.find((x) => x.spec_id === specId) ?? null;
  const status = spec?.status ?? null;
  const progress = !spec
    ? 0
    : ["draft", "generated", "awaiting_review"].includes(status ?? "")
      ? 1
      : ["approved", "building", "needs_human"].includes(status ?? "")
        ? 2
        : 3;
  const failed = status === "needs_human";
  return (
    <div style={{ margin: "0 0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {BUILDER_STEPS.map((st, i) => {
          const current = page === st.id;
          const complete = i < progress;
          const stateColor = failed && i === 2 ? "var(--pf-bad)" : complete ? "var(--pf-ok)" : current ? "var(--pf-acc)" : "var(--pf-tmut)";
          return (
            <div key={st.id} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <div style={{ width: 34, height: 2, background: i <= progress ? "var(--pf-ok)" : "var(--pf-bd2)", margin: "0 6px" }} />}
              <button
                onClick={() => onNav(st.id)}
                className="pf-step"
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                  borderRadius: 20, cursor: "pointer", fontFamily: "var(--pf-font-sans)",
                  border: `1px solid ${current ? "var(--pf-acc)" : "var(--pf-bd2)"}`,
                  background: current ? "var(--pf-acc-soft)" : "var(--pf-surf)",
                  color: current ? "var(--pf-tpri)" : "var(--pf-tsec)",
                  fontWeight: current ? 600 : 500, fontSize: "var(--fs-small)",
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: "50%", display: "inline-flex",
                  alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
                  background: stateColor, color: "#fff",
                }}>
                  {failed && i === 2 ? "!" : complete ? "\u2713" : i + 1}
                </span>
                {st.label}
              </button>
            </div>
          );
        })}
        <span style={{ marginLeft: 14, fontSize: "var(--fs-micro)", color: "var(--pf-tmut)" }}>
          {spec ? `${spec.entity} \u00b7 ${status}` : "no spec selected \u2014 start with a contract"}
        </span>
      </div>
    </div>
  );
}
