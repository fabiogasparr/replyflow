import { describe, expect, it } from "vitest";
import {
  assertWorkspacePlanCapacity,
  workspacePlanDetails,
  WorkspaceBillingSetupError,
  WorkspacePlanLimitError,
} from "@/lib/billing/plans";

describe("workspace plan limits", () => {
  it("maps labels and limits only from the persisted plan", () => {
    expect(
      workspacePlanDetails({
        code: "PRO",
        name: "Profissional",
        instagramAccounts: 7,
        members: 12,
      })
    ).toEqual({
      code: "PRO",
      label: "Profissional",
      limits: { instagramAccounts: 7, members: 12 },
    });
  });

  it("rejects capacity at the boundary with a structured error", () => {
    expect(() =>
      assertWorkspacePlanCapacity("instagramAccounts", 1, 1)
    ).toThrowError(WorkspacePlanLimitError);

    expect(assertWorkspacePlanCapacity("members", 4, 10)).toEqual({
      used: 4,
      limit: 10,
      remaining: 6,
    });
  });

  it("distinguishes an unavailable subscription from an exhausted plan", () => {
    const error = new WorkspaceBillingSetupError();

    expect(error.code).toBe("BILLING_SETUP_INCOMPLETE");
    expect(error).not.toBeInstanceOf(WorkspacePlanLimitError);
  });
});
