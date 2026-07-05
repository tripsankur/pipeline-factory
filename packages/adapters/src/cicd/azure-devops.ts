import type { CicdAdapter, PipelineStatus, PullRequestRef } from "./types.js";

/** Coming soon (feature flag `azure_devops`). Typed skeleton only — handoff §4. */
export class AzureDevOpsAdapter implements CicdAdapter {
  readonly kind = "azure-devops";

  async createBranch(): Promise<void> {
    throw new Error("Azure DevOps adapter is coming soon");
  }
  async commitFiles(): Promise<void> {
    throw new Error("Azure DevOps adapter is coming soon");
  }
  async openPullRequest(): Promise<PullRequestRef> {
    throw new Error("Azure DevOps adapter is coming soon");
  }
  async getPipelineStatus(): Promise<PipelineStatus> {
    throw new Error("Azure DevOps adapter is coming soon");
  }
}
