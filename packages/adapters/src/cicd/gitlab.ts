import type { CicdAdapter, PipelineStatus, PullRequestRef } from "./types.js";

/** Coming soon (feature flag `gitlab`). Typed skeleton only — handoff §4. */
export class GitLabAdapter implements CicdAdapter {
  readonly kind = "gitlab";

  async createBranch(): Promise<void> {
    throw new Error("GitLab adapter is coming soon");
  }
  async commitFiles(): Promise<void> {
    throw new Error("GitLab adapter is coming soon");
  }
  async openPullRequest(): Promise<PullRequestRef> {
    throw new Error("GitLab adapter is coming soon");
  }
  async getPipelineStatus(): Promise<PipelineStatus> {
    throw new Error("GitLab adapter is coming soon");
  }
}
