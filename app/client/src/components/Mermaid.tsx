import { useEffect, useRef, useState } from "react";

// mermaid is heavy (~1 MB) — dynamic import keeps it out of the main bundle;
// it only loads when a diagram scrolls into the Docs page.
let mermaidModule: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  mermaidModule ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: "neutral",
      themeVariables: {
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "12px",
        primaryColor: "#eff6fb",
        primaryBorderColor: "#2272B4",
        primaryTextColor: "#11171C",
        lineColor: "#5F7281",
      },
      flowchart: { curve: "basis" },
      sequence: { actorMargin: 40 },
    });
    return m;
  });
  return mermaidModule;
}

let counter = 0;

export function Mermaid({ code, title, caption }: { code: string; title: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMermaid()
      .then((m) => m.default.render(`pf-mmd-${++counter}`, code))
      .then((r) => {
        if (!cancelled) setSvg(r.svg);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <figure style={{ margin: "0 0 18px" }}>
      <figcaption style={{ fontWeight: 600, fontSize: "var(--fs-small)", marginBottom: 6 }}>{title}</figcaption>
      {err ? (
        <pre style={{ color: "var(--pf-bad)", fontSize: "var(--fs-micro)" }}>diagram failed to render: {err}</pre>
      ) : svg ? (
        <div
          ref={ref}
          style={{
            border: "1px solid var(--pf-bd)",
            borderRadius: "var(--rad)",
            padding: 12,
            background: "#fff",
            overflowX: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div style={{ color: "var(--pf-tmut)", fontSize: "var(--fs-micro)", padding: 12 }}>rendering diagram…</div>
      )}
      {caption && (
        <div style={{ color: "var(--pf-tsec)", fontSize: "var(--fs-micro)", marginTop: 6 }}>{caption}</div>
      )}
    </figure>
  );
}
