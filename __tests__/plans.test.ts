import { describe, expect, it } from "vitest";
import {
  assertWorkspacePlanCapacity,
  getWorkspacePlanDetails,
  WorkspacePlanLimitError,
} from "@/lib/billing/plans";

describe("workspace plan limits", () => {
  it("defines progressively larger account and member allowances", () => {
    expect(getWorkspacePlanDetails("FREE").limits).toEqual({
      instagramAccounts: 1,
      members: 2,
    });
    expect(getWorkspacePlanDetails("PRO").limits).toEqual({
      instagramAccounts: 3,
      members: 10,
    });
    expect(getWorkspacePlanDetails("AGENCY").limits).toEqual({
      instagramAccounts: 10,
      members: 50,
    });
  });

  it("rejects capacity at the boundary with a structured error", () => {
    expect(() =>
      assertWorkspacePlanCapacity("FREE", "instagramAccounts", 1)
    ).toThrowError(WorkspacePlanLimitError);

    expect(
      assertWorkspacePlanCapacity("PRO", "members", 4)
    ).toEqual({ used: 4, limit: 10, remaining: 6 });
  });
});
