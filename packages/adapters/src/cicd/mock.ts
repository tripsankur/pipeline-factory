import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CicdAdapter, CommitFile, PipelineStatus, PullRequestRef } from "./types.js";

/**
 * Mock CI/CD adapter: writes branches to a local directory tree.
 * Used by tests and until a GitHub PAT lands in the secret scope.
 */
export class MockCicdAdapter implements CicdAdapter {
  readonly kind = "mock";
  private prCounter = 0;

  constructor(private readonly rootDir: string) {}

  branchDir(branch: string): string {
    return join(this.rootDir, branch.replaceAll("/", "__"));
  }

  async createBranch(name: string): Promise<void> {
    await mkdir(this.branchDir(name), { recursive: true });
  }

  async commitFiles(branch: string, files: CommitFile[], message: string): Promise<void> {
    const dir = this.branchDir(branch);
    for (const f of files) {
      const p = join(dir, f.path);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, f.content, "utf8");
    }
    await writeFile(join(dir, ".commit-message"), message, "utf8");
  }

  async openPullRequest(branch: string, title: string, evidenceMarkdown: string): Promise<PullRequestRef> {
    const dir = this.branchDir(branch);
    await writeFile(join(dir, ".pr.md"), `# ${title}\n\n${evidenceMarkdown}`, "utf8");
    this.prCounter += 1;
    return { url: `mock://pr/${this.prCounter}`, number: this.prCounter, branch };
  }

  async getPipelineStatus(): Promise<PipelineStatus> {
    return "success";
  }
}
