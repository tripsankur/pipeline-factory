import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Mono } from "./ui";
import { useToast } from "./Toast";

interface UcConnection {
  name: string;
  type: string;
  comment: string;
}

const inputStyle = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--pf-bd2)",
  background: "var(--pf-input-bg)",
  color: "var(--pf-tpri)",
  fontFamily: "var(--pf-font-mono)",
  fontSize: 11.2,
} as const;

export default function ConnectionsManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [form, setForm] = useState({ name: "sfdc_sample", client_id: "", client_secret: "", is_sandbox: false });
  const [redirectUri, setRedirectUri] = useState<string>(`${window.location.origin}/api/connections/sfdc/callback`);

  const list = useQuery({
    queryKey: ["connections-uc"],
    queryFn: async (): Promise<{ connections: UcConnection[] }> => {
      const r = await fetch("/api/connections");
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    },
  });

  // surface OAuth wizard outcome after the redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("connected");
    const err = params.get("connect_error");
    if (ok) toast(`Connection "${ok}" created — ready for ingestion`);
    if (err) toast(`Connection failed: ${err}`, "bad");
    if (ok || err) window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/connections/sfdc/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ authorize_url: string; redirect_uri: string }>;
    },
    onSuccess: (r) => {
      setRedirectUri(r.redirect_uri);
      window.location.href = r.authorize_url; // Salesforce consent, then back here
    },
    onError: (e) => toast(String(e).slice(0, 200), "bad"),
  });

  const reconnect = useMutation({
    mutationFn: async (name: string) => {
      // no client_id/secret: the server reuses the credentials already in the
      // secret scope — only the browser consent happens again
      const r = await fetch("/api/connections/sfdc/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ authorize_url: string }>;
    },
    onSuccess: (r) => {
      window.location.href = r.authorize_url;
    },
    onError: (e) => toast(String(e).slice(0, 200), "bad"),
  });

  const del = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch(`/api/connections/${name}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["connections-uc"] }),
    onError: (e) => toast(String(e).slice(0, 200), "bad"),
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px" }}>
        <h3 style={{ fontSize: 12.8, margin: 0 }}>Source connections</h3>
        <span style={{ fontSize: 10.4, color: "var(--pf-tmut)" }}>
          Unity Catalog connections, managed by the app
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Button kind="ghost" onClick={() => setWizardOpen((v) => !v)}>
            {wizardOpen ? "Close wizard" : "+ Salesforce connection"}
          </Button>
        </div>
      </div>

      {wizardOpen && (
        <Card style={{ marginBottom: 12, padding: 18 }} >
          <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--pf-tsec)", lineHeight: 1.6 }}>
            One-time in your Salesforce org: <strong>Setup → App Manager → New Connected App</strong> —
            enable OAuth, scopes <Mono>api refresh_token offline_access</Mono>, callback URL:
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <Mono>{redirectUri}</Mono>
            <Button kind="ghost" onClick={() => { void navigator.clipboard.writeText(redirectUri); toast("Callback URL copied"); }}>
              Copy
            </Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ fontSize: 10.8, color: "var(--pf-tsec)" }}>
              Connection name
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label style={{ fontSize: 10.8, color: "var(--pf-tsec)", display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 6 }}>
              <input
                type="checkbox"
                checked={form.is_sandbox}
                onChange={(e) => setForm({ ...form, is_sandbox: e.target.checked })}
              />
              sandbox org (test.salesforce.com)
            </label>
            <label style={{ fontSize: 10.8, color: "var(--pf-tsec)" }}>
              Consumer key (client_id)
              <input style={inputStyle} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
            </label>
            <label style={{ fontSize: 10.8, color: "var(--pf-tsec)" }}>
              Consumer secret
              <input
                style={inputStyle}
                type="password"
                value={form.client_secret}
                onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
              />
            </label>
          </div>
          <p style={{ fontSize: 10.4, color: "var(--pf-tmut)", margin: "10px 0" }}>
            Keys go browser → app → Databricks secret scope. Nothing is stored anywhere else.
            Clicking connect sends you to Salesforce to consent, then straight back here.
            <strong> Reconnecting?</strong> Leave key/secret empty — the app reuses the stored ones.
          </p>
          <Button onClick={() => start.mutate()} disabled={start.isPending || !form.name}>
            {start.isPending ? "Preparing…" : form.client_id ? "Connect to Salesforce" : "Connect (reuse stored credentials)"}
          </Button>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {list.isLoading && <p style={{ padding: 14, color: "var(--pf-tsec)" }}>Loading…</p>}
        {list.isError && <p style={{ padding: 14, color: "var(--pf-bad)" }}>{String(list.error).slice(0, 200)}</p>}
        {(list.data?.connections ?? []).length === 0 && !list.isLoading && (
          <p style={{ padding: 14, color: "var(--pf-tmut)", fontSize: 11.5 }}>
            No source connections yet — add Salesforce above.
          </p>
        )}
        {(list.data?.connections ?? []).map((c) => (
          <div
            key={c.name}
            style={{ padding: "9px 16px", borderTop: "1px solid var(--pf-bd)", display: "flex", gap: 12, alignItems: "center" }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--pf-ok)" }} />
            <Mono>{c.name}</Mono>
            <span style={{ fontSize: 10, color: "var(--pf-tmut)", textTransform: "uppercase", letterSpacing: 0.6 }}>{c.type}</span>
            <span style={{ fontSize: 10.4, color: "var(--pf-tmut)" }}>{c.comment}</span>
            {c.type === "SALESFORCE" && (
              <button
                onClick={() => reconnect.mutate(c.name)}
                disabled={reconnect.isPending}
                title="Re-run the OAuth consent using the stored Connected App credentials — nothing to re-enter"
                style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--pf-acc)", cursor: "pointer", fontSize: 10.8 }}
              >
                {reconnect.isPending ? "redirecting…" : "reconnect"}
              </button>
            )}
            <button
              onClick={() => del.mutate(c.name)}
              style={{ marginLeft: c.type === "SALESFORCE" ? 0 : "auto", background: "none", border: "none", color: "var(--pf-bad)", cursor: "pointer", fontSize: 10.8 }}
            >
              remove
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}
