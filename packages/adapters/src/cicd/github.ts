import { Octokit } from "octokit";
import type { CicdAdapter, CommitFile, PipelineStatus, PullRequestRef } from "./types.js";

export interface GitHubAdapterConfig {
  /** "owner/repo" */
  repo: string;
  token: string;
  /** base branch PRs target; default: repository default branch */
  baseBranch?: string | undefined;
}

/** GitHub CicdAdapter (adapter #1, handoff §4) — octokit stays inside this file. */
export class GitHubCicdAdapter implements CicdAdapter {
  readonly kind = "github";
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private base: string | undefined;

  constructor(cfg: GitHubAdapterConfig) {
    const [owner, repo] = cfg.repo.split("/");
    if (!owner || !repo) throw new Error(`PF_GITHUB_REPO must be "owner/repo", got "${cfg.repo}"`);
    this.owner = owner;
    this.repo = repo;
    this.base = cfg.baseBranch;
    this.octokit = new Octokit({ auth: cfg.token });
  }

  private async baseBranch(): Promise<string> {
    if (this.base) return this.base;
    const { data } = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
    this.base = data.default_branch;
    return this.base;
  }

  async createBranch(name: string, fromRef?: string): Promise<void> {
    const base = fromRef ?? (await this.baseBranch());
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${base}`,
    });
    try {
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${name}`,
        sha: ref.object.sha,
      });
    } catch (err) {
      // 422 = branch exists; treat as idempotent success
      if (!(err instanceof Error && err.message.includes("Reference already exists"))) throw err;
    }
  }

  async commitFiles(branch: string, files: CommitFile[], message: string): Promise<void> {
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
    });
    const { data: baseCommit } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: ref.object.sha,
    });
    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: "100644" as const, type: "blob" as const, content: f.content })),
    });
    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: tree.sha,
      parents: [ref.object.sha],
    });
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });
  }

  async openPullRequest(branch: string, title: string, evidenceMarkdown: string): Promise<PullRequestRef> {
    const base = await this.baseBranch();
    // idempotent: reuse an open PR for the branch if present
    const { data: existing } = await this.octokit.rest.pulls.list({
      owner: this.owner,
      repo: this.repo,
      head: `${this.owner}:${branch}`,
      state: "open",
    });
    if (existing[0]) {
      return { url: existing[0].html_url, number: existing[0].number, branch };
    }
    const { data: pr } = await this.octokit.rest.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      head: branch,
      base,
      body: evidenceMarkdown,
    });
    return { url: pr.html_url, number: pr.number, branch };
  }

  async getPipelineStatus(branch: string): Promise<PipelineStatus> {
    const { data } = await this.octokit.rest.checks.listForRef({
      owner: this.owner,
      repo: this.repo,
      ref: branch,
    });
    if (data.total_count === 0) return "unknown";
    const runs = data.check_runs;
    if (runs.some((r) => r.status !== "completed")) return "running";
    if (runs.every((r) => r.conclusion === "success")) return "success";
    return runs.some((r) => r.conclusion === "failure") ? "failure" : "unknown";
  }
}
