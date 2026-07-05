import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastMsg {
  id: number;
  text: string;
  kind: "ok" | "bad";
}

const ToastContext = createContext<(text: string, kind?: "ok" | "bad") => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, kind: "ok" | "bad" = "ok") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 100 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "var(--pf-toast-bg)",
              border: "1px solid var(--pf-bd2)",
              borderLeft: `3px solid var(--pf-${t.kind})`,
              color: "var(--pf-tpri)",
              borderRadius: 10,
              padding: "11px 16px",
              fontSize: 13,
              boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
              animation: "pf_slidein 0.2s ease-out",
              maxWidth: 380,
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
