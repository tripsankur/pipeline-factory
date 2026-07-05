import { useEffect, useRef, useState } from "react";
import { streamBuild, type BuildEvent } from "../api";
import { Button, Card, Mono } from "../components/ui";

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "render", label: "Render" },
  { id: "branch", label: "Branch" },
  { id: "deploy_dev", label: "Deploy dev" },
  { id: "pipeline_run", label: "Pipeline run" },
  { id: "tests", label: "Tests" },
  { id: "recon", label: "Recon" },
  { id: "pr", label: "PR" },
];

interface StepState {
  status: "pending" | "running" | "done" | "deferred" | "failed";
  meta: string;
}

const initialSteps = (): Record<string, StepState> =>
  Object.fromEntries(STEP_DEFS.map((s) => [s.id, { status: "pending", meta: "" }]));

export default function BuildConsole({ specId }: { specId: string | null }) {
  const [steps, setSteps] = useState<Record<string, StepState>>(initialSteps);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ pr?: { url: string; number: number }; error?: string } | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => () => cancelRef.current?.(), []);

  const start = () => {
    if (!specId || running) return;
    setSteps(initialSteps());
    setLogs([]);
    setResult(null);
    setRunning(true);
    cancelRef.current = streamBuild(
      specId,
      (e: BuildEvent) => {
        if (e.type === "step" && e.step) {
          setSteps((s) => ({ ...s, [e.step!]: { status: e.status ?? "pending", meta: e.meta ?? "" } }));
        } else if (e.type === "log" && e.text) {
          setLogs((l) => [...l, e.text!]);
        } else if (e.type === "done") {
          setResult({ pr: e.pr });
        } else if (e.type === "error") {
          setResult({ error: e.text ?? "build failed" });
        }
      },
      () => setRunning(false),
    );
  };

  if (!specId) {
    return <p style={{ color: "var(--pf-tsec)" }}>Approve a spec, then run its build here.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
        <Mono>{specId}</Mono>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {result?.pr && (
            <span style={{ fontSize: 12.5, color: "var(--pf-ok)" }}>
              PR{" "}
              {result.pr.url.startsWith("http") ? (
                <a href={result.pr.url} target="_blank" rel="noreferrer" style={{ color: "var(--pf-acc)" }}>
                  #{result.pr.number}
                </a>
              ) : (
                <Mono>{result.pr.url}</Mono>
              )}{" "}
              opened — merge is yours (human gate #2)
            </span>
          )}
          {result?.error && <span style={{ fontSize: 12.5, color: "var(--pf-bad)" }}>{result.error}</span>}
          <Button onClick={start} disabled={running}>
            {running ? "Building…" : "Run build"}
          </Button>
        </div>
      </Card>

      {/* stepper */}
      <Card style={{ padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {STEP_DEFS.map((def, i) => {
            const st = steps[def.id] ?? { status: "pending", meta: "" };
            const color =
              st.status === "done"
                ? "var(--pf-acc)"
                : st.status === "running"
                  ? "var(--pf-warn)"
                  : st.status === "failed"
                    ? "var(--pf-bad)"
                    : "var(--pf-bd2)";
            return (
              <div key={def.id} style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 84 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      border: `2px solid ${color}`,
                      background: st.status === "done" ? "var(--pf-acc)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: st.status === "done" ? "var(--pf-acc-tx)" : color,
                      fontSize: 13,
                      animation: st.status === "running" ? "pf_pulse 1.2s ease-in-out infinite" : undefined,
                    }}
                  >
                    {st.status === "done" ? "✓" : st.status === "running" ? "◌" : st.status === "deferred" ? "…" : "＋"}
                  </div>
                  <div
                    style={{
                      marginTop: 7,
                      fontSize: 12,
                      fontWeight: 600,
                      color: st.status === "pending" || st.status === "deferred" ? "var(--pf-tmut)" : "var(--pf-tpri)",
                    }}
                  >
                    {def.label}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--pf-tmut)", textAlign: "center", maxWidth: 110 }}>
                    {st.meta}
                  </div>
                </div>
                {i < STEP_DEFS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      marginTop: 13,
                      background: st.status === "done" ? "var(--pf-acc)" : "var(--pf-bd2)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* live log */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--pf-bd)",
            fontSize: 11.5,
            color: "var(--pf-tmut)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: running ? "var(--pf-run)" : "var(--pf-bd2)",
              animation: running ? "pf_blink 1.2s ease-in-out infinite" : undefined,
            }}
          />
          build log {running ? "· live" : ""}
        </div>
        <div
          style={{
            background: "var(--pf-log-bg)",
            padding: 14,
            minHeight: 180,
            maxHeight: 320,
            overflow: "auto",
            fontFamily: "var(--pf-font-mono)",
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--pf-tsec)",
          }}
        >
          {logs.length === 0 && <span style={{ color: "var(--pf-tmut)" }}>— no output yet —</span>}
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.includes("✓") ? "var(--pf-ok)" : undefined }}>
              {l}
            </div>
          ))}
          {running && <span style={{ animation: "pf_blink 1s step-end infinite" }}>▌</span>}
          <div ref={logEndRef} />
        </div>
      </Card>

      {/* runner notice — honest, not mocked */}
      <Card style={{ borderColor: "var(--pf-warn)", background: "var(--pf-warn-soft)", padding: "12px 18px" }}>
        <span style={{ fontSize: 12.5, color: "var(--pf-tsec)" }}>
          <strong style={{ color: "var(--pf-warn)" }}>Runner steps deferred:</strong> deploy / pipeline run /
          tests / recon execute as Databricks runner jobs (milestone M4). The PR carries render + mapping
          evidence today; recon results attach automatically once runners land.
        </span>
      </Card>
    </div>
  );
}
