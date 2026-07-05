import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MAIN_NAV, LOCKED_NAV } from "./nav";
import { api } from "./api";
import Fleet from "./pages/Fleet";
import Intake from "./pages/Intake";
import Mapping from "./pages/Mapping";
import Artifacts from "./pages/Artifacts";
import { Card } from "./components/ui";

interface ConnectionStatus {
  name: string;
  ok: boolean;
  detail: string;
}

function useConnections(enabled: boolean) {
  return useQuery({
    queryKey: ["connections"],
    queryFn: async (): Promise<{ connections: ConnectionStatus[] }> => {
      const r = await fetch("/api/settings/connections");
      if (!r.ok) throw new Error(`connections check failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
    enabled,
  });
}

const S = {
  sidebar: {
    width: 250,
    flexShrink: 0,
    background: "var(--pf-surf)",
    borderRight: "1px solid var(--pf-bd)",
    display: "flex",
    flexDirection: "column",
  } as const,
  navBtn(active: boolean, locked: boolean) {
    return {
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      textAlign: "left" as const,
      padding: "9px 14px",
      border: "none",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 13.5,
      fontFamily: "var(--pf-font-sans)",
      background: active ? "var(--pf-acc-soft)" : "transparent",
      color: active ? "var(--pf-acc)" : locked ? "var(--pf-tmut)" : "var(--pf-tsec)",
      fontWeight: active ? 600 : 400,
    };
  },
};

export default function App() {
  const [page, setPage] = useState("fleet");
  const [activeSpecId, setActiveSpecId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const connections = useConnections(page === "settings");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  };

  const openLocked = (id: string) => {
    api.featureClick(id);
    setPage(id);
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <aside style={S.sidebar}>
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
              fontSize: 15,
            }}
          >
            PF
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Pipeline Factory</div>
            <div style={{ fontSize: 11, color: "var(--pf-tmut)" }}>ingestion builder</div>
          </div>
        </div>

        <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {MAIN_NAV.map((item) => (
            <button key={item.id} style={S.navBtn(page === item.id, false)} onClick={() => setPage(item.id)}>
              {item.label}
            </button>
          ))}
          <div
            style={{
              margin: "14px 14px 6px",
              fontSize: 10.5,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--pf-tmut)",
            }}
          >
            Coming soon
          </div>
          {LOCKED_NAV.map((item) => (
            <button key={item.id} style={S.navBtn(page === item.id, true)} onClick={() => openLocked(item.id)}>
              {item.label}
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 9.5,
                  padding: "2px 7px",
                  borderRadius: 20,
                  background: "var(--pf-chip)",
                  border: "1px solid var(--pf-bd)",
                  color: "var(--pf-tmut)",
                }}
              >
                soon
              </span>
            </button>
          ))}
        </nav>

        <div style={{ padding: 14, borderTop: "1px solid var(--pf-bd)" }}>
          <button style={S.navBtn(false, false)} onClick={toggleTheme}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: "auto", padding: 28 }}>
        <h1 style={{ fontSize: 19, margin: "0 0 18px" }}>
          {[...MAIN_NAV, ...LOCKED_NAV].find((n) => n.id === page)?.label ?? page.replaceAll("_", " ")}
        </h1>

        {page === "fleet" && (
          <Fleet
            onOpenSpec={(id) => {
              setActiveSpecId(id);
              setPage("mapping");
            }}
          />
        )}
        {page === "intake" && (
          <Intake
            onSpecCreated={(id) => {
              setActiveSpecId(id);
              setPage("mapping");
            }}
          />
        )}
        {page === "mapping" && (
          <Mapping
            specId={activeSpecId}
            onApproved={(id) => {
              setActiveSpecId(id);
              setPage("evidence");
            }}
          />
        )}
        {page === "evidence" && <Artifacts specId={activeSpecId} />}
        {page === "build" && (
          <p style={{ color: "var(--pf-tsec)" }}>Build console lands with the runner milestone (M4).</p>
        )}
        {page === "history" && (
          <p style={{ color: "var(--pf-tsec)" }}>Spec history & audit lands with M5.</p>
        )}
        {page === "settings" && <ConnectionsPanel state={connections} />}
        {LOCKED_NAV.some((n) => n.id === page) && <ComingSoon id={page} />}
      </main>
    </div>
  );
}

function ConnectionsPanel({ state }: { state: ReturnType<typeof useConnections> }) {
  if (state.isLoading) return <p style={{ color: "var(--pf-tsec)" }}>Checking connections…</p>;
  if (state.isError) return <p style={{ color: "var(--pf-bad)" }}>{String(state.error)}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
      {state.data?.connections.map((c) => (
        <div
          key={c.name}
          style={{
            background: "var(--pf-surf)",
            border: "1px solid var(--pf-bd)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: c.ok ? "var(--pf-ok)" : "var(--pf-bad)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 13, minWidth: 120 }}>{c.name}</span>
          <span style={{ color: "var(--pf-tsec)", fontSize: 12.5, fontFamily: "var(--pf-font-mono)" }}>
            {c.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

function ComingSoon({ id }: { id: string }) {
  return (
    <Card style={{ maxWidth: 520, padding: 28 }}>
      <div
        style={{
          display: "inline-block",
          fontSize: 10.5,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--pf-acc)",
          background: "var(--pf-acc-soft)",
          padding: "4px 10px",
          borderRadius: 20,
          marginBottom: 14,
        }}
      >
        Coming soon
      </div>
      <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>{id.replaceAll("_", " ")}</h2>
      <p style={{ color: "var(--pf-tsec)", fontSize: 13.5, lineHeight: 1.6 }}>
        This capability is on the roadmap. Your click was logged — it helps us prioritize.
      </p>
    </Card>
  );
}
