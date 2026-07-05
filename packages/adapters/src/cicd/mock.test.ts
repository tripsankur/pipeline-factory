import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockCicdAdapter } from "./mock.js";

describe("MockCicdAdapter", () => {
  it("writes branch files, commit message, and PR body to disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "pf-mock-"));
    const cicd = new MockCicdAdapter(root);
    const branch = "feat/orders-ingestion-v1";

    await cicd.createBranch(branch);
    await cicd.commitFiles(branch, [{ path: "pipelines/orders/a.sql", content: "select 1\n" }], "msg\nspec_id: s1");
    const pr = await cicd.openPullRequest(branch, "title", "evidence body");

    const dir = cicd.branchDir(branch);
    expect(await readFile(join(dir, "pipelines/orders/a.sql"), "utf8")).toBe("select 1\n");
    expect(await readFile(join(dir, ".commit-message"), "utf8")).toContain("spec_id: s1");
    expect(await readFile(join(dir, ".pr.md"), "utf8")).toContain("evidence body");
    expect(pr.number).toBe(1);
    expect(await cicd.getPipelineStatus()).toBe("success");
  });
});
