export type WorkspacePlanLimits = {
  instagramAccounts: number;
  members: number;
};

export type WorkspaceLimitResource = keyof WorkspacePlanLimits;

export function workspacePlanDetails(plan: {
  code: "FREE" | "PRO" | "AGENCY";
  name: string;
  instagramAccounts: number;
  members: number;
}) {
  return {
    code: plan.code,
    label: plan.name,
    limits: {
      instagramAccounts: plan.instagramAccounts,
      members: plan.members,
    },
  };
}

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

export class WorkspaceBillingSetupError extends Error {
  readonly code = "BILLING_SETUP_INCOMPLETE";

  constructor() {
    super("Workspace subscription is not ready");
    this.name = "WorkspaceBillingSetupError";
  }
}

export function assertWorkspacePlanCapacity(
  resource: WorkspaceLimitResource,
  used: number,
  limit: number
) {
  if (used >= limit) {
    throw new WorkspacePlanLimitError(resource, limit);
  }
  return { used, limit, remaining: limit - used };
}
