import type { WorkspacePlan } from "@/app/generated/prisma/client";

export type WorkspacePlanLimits = {
  instagramAccounts: number;
  members: number;
};

export const WORKSPACE_PLANS: Record<
  WorkspacePlan,
  { label: string; limits: WorkspacePlanLimits }
> = {
  FREE: {
    label: "Free",
    limits: { instagramAccounts: 1, members: 2 },
  },
  PRO: {
    label: "Pro",
    limits: { instagramAccounts: 3, members: 10 },
  },
  AGENCY: {
    label: "Agência",
    limits: { instagramAccounts: 10, members: 50 },
  },
};

export type WorkspaceLimitResource = keyof WorkspacePlanLimits;

export class WorkspacePlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";

  constructor(
    readonly resource: WorkspaceLimitResource,
    readonly limit: number
  ) {
    super(`Workspace plan limit reached for ${resource}`);
    this.name = "WorkspacePlanLimitError";
  }
}

export function getWorkspacePlanDetails(plan: WorkspacePlan) {
  return WORKSPACE_PLANS[plan];
}

export function assertWorkspacePlanCapacity(
  plan: WorkspacePlan,
  resource: WorkspaceLimitResource,
  used: number
) {
  const limit = WORKSPACE_PLANS[plan].limits[resource];
  if (used >= limit) {
    throw new WorkspacePlanLimitError(resource, limit);
  }
  return { used, limit, remaining: limit - used };
}
