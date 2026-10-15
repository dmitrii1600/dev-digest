import type { CiPostAs, CiTrigger } from "@devdigest/shared";

export const TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const POST_AS: readonly { value: CiPostAs; key: "githubReview" | "prComment" | "none" }[] = [
  { value: "github_review", key: "githubReview" },
  { value: "pr_comment", key: "prComment" },
  { value: "none", key: "none" },
];
