import type { CSSProperties, ReactNode } from "react";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="pf-card"
      style={{
        background: "var(--pf-surf)",
        border: "1px solid var(--pf-bd)",
        borderRadius: 12,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  kind = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const base: CSSProperties = {
    padding: "9px 18px",
    borderRadius: 8,
    fontSize: 12.4,
    fontWeight: 600,
    fontFamily: "var(--pf-font-sans)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "1px solid transparent",
  };
  const kinds: Record<string, CSSProperties> = {
    primary: { background: "var(--pf-acc)", color: "var(--pf-acc-tx)" },
    ghost: { background: "transparent", color: "var(--pf-tsec)", border: "1px solid var(--pf-bd2)" },
    danger: { background: "var(--pf-bad-soft)", color: "var(--pf-bad)" },
  };
  return (
    <button className="pf-btn" style={{ ...base, ...kinds[kind] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const level = value >= 0.9 ? "ok" : value >= 0.75 ? "warn" : "bad";
  return (
    <span
      style={{
        fontSize: 10.8,
        fontFamily: "var(--pf-font-mono)",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        color: `var(--pf-${level})`,
        background: `var(--pf-${level}-soft)`,
      }}
    >
      {(value * 100).toFixed(0)}%
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: "ok",
    done: "ok",
    pr_open: "run",
    building: "run",
    generated: "warn",
    draft: "warn",
    needs_human: "bad",
  };
  const c = map[status] ?? "warn";
  return (
    <span
      style={{
        fontSize: 10.4,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 20,
        color: `var(--pf-${c})`,
        background: c === "run" ? "rgba(56,189,248,0.15)" : `var(--pf-${c}-soft)`,
      }}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: "var(--pf-font-mono)", fontSize: 10.8 }}>{children}</span>
  );
}
