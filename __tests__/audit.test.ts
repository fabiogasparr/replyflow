import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";

describe("audit event data", () => {
  it("stores a scoped action without optional sensitive payloads", () => {
    expect(
      createAuditEventData({
        workspaceId: "workspace_1",
        actorUserId: "user_1",
        action: AUDIT_ACTIONS.memberRemoved,
        targetType: "User",
        targetId: "user_2",
      })
    ).toEqual({
      workspaceId: "workspace_1",
      actorUserId: "user_1",
      action: "MEMBER_REMOVED",
      targetType: "User",
      targetId: "user_2",
    });
  });

  it("accepts only explicit metadata chosen by the caller", () => {
    expect(
      createAuditEventData({
        workspaceId: "workspace_1",
        action: AUDIT_ACTIONS.workspaceRenamed,
        metadata: { previousName: "Aurora", name: "Boreal" },
      })
    ).toMatchObject({
      actorUserId: null,
      targetType: null,
      targetId: null,
      metadata: { previousName: "Aurora", name: "Boreal" },
    });
  });
});
