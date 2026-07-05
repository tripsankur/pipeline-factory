/**
 * CicdAdapter — the CI/CD-agnostic boundary (hard constraint #8, handoff §4).
 * Only branch/PR mechanics. Core never imports a vendor SDK directly.
 */

export interface CommitFile {
  path: string;
  content: string;
}

export interface PullRequestRef {
  url: string;
  number: number;
  branch: string;
}

export type PipelineStatus = "pending" | "running" | "success" | "failure" | "unknown";

export interface CicdAdapter {
  readonly kind: string;
  createBranch(name: string, fromRef?: string): Promise<void>;
  commitFiles(branch: string, files: CommitFile[], message: string): Promise<void>;
  openPullRequest(branch: string, title: string, evidenceMarkdown: string): Promise<PullRequestRef>;
  getPipelineStatus(branch: string): Promise<PipelineStatus>;
}
