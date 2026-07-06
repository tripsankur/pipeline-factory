/**
 * Headless smoke: exercises the deployed factory's full loop before demos.
 * Usage: DATABRICKS_TOKEN=... PF_APP_URL=... node scripts/smoke.mjs [spec-id]
 * Exits non-zero unless the build stream reaches `done` with a PR.
 */
const base = process.env.PF_APP_URL ?? "https://pipeline-factory-7474658437363349.aws.databricksapps.com";
const token = process.env.DATABRICKS_TOKEN;
if (!token) throw new Error("DATABRICKS_TOKEN required");
const headers = { Authorization: `Bearer ${token}` };

const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};

// 1. connections all green
const { connections } = await get("/api/settings/connections");
for (const c of connections) {
  console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail.slice(0, 70)}`);
  if (!c.ok) process.exit(1);
}

// 2. pick spec (arg or newest)
const specId = process.argv[2] ?? (await get("/api/fleet")).specs[0]?.spec_id;
if (!specId) {
  console.error("no specs in registry — run intake first");
  process.exit(1);
}
console.log(`▸ building ${specId} (streaming)`);

// 3. stream the build to completion
const res = await fetch(`${base}/api/specs/${specId}/build/stream`, { headers });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";
let done = false;
let failed = null;
for (;;) {
  const { value, done: eof } = await reader.read();
  if (eof) break;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf("\n\n")) >= 0) {
    const chunk = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    if (!chunk.startsWith("data: ")) continue;
    const e = JSON.parse(chunk.slice(6));
    if (e.type === "log") console.log(`  ${e.text}`);
    if (e.type === "fix") console.log(`  ⚠ fix ${e.iteration}/${e.maxIterations}: ${e.meta}`);
    if (e.type === "done") { done = true; console.log(`✓ PR: ${e.pr.url}`); }
    if (e.type === "error") failed = e.text;
  }
}
if (!done) {
  console.error(`✗ smoke failed: ${failed ?? "stream ended without done"}`);
  process.exit(1);
}
console.log("✓ smoke passed");
