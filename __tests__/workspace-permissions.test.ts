import { describe, expect, it } from "vitest";
import {
  canArchiveWorkspace,
  canAssignWorkspaceRole,
  canManageAutomations,
  canManageBilling,
  canManageInstagram,
  canManageMembers,
  canManageWorkspaceMember,
  hasWorkspacePermission,
} from "@/lib/workspace-permissions";

describe("workspace role permissions", () => {
  it("gives owners full administrative control", () => {
    expect(canManageAutomations("OWNER")).toBe(true);
    expect(canManageInstagram("OWNER")).toBe(true);
    expect(canManageMembers("OWNER")).toBe(true);
    expect(canManageBilling("OWNER")).toBe(true);
    expect(canArchiveWorkspace("OWNER")).toBe(true);
  });

  it("keeps billing and archiving exclusive to owners", () => {
    expect(canManageAutomations("ADMIN")).toBe(true);
    expect(canManageInstagram("ADMIN")).toBe(true);
    expect(canManageMembers("ADMIN")).toBe(true);
    expect(canManageBilling("ADMIN")).toBe(false);
    expect(canArchiveWorkspace("ADMIN")).toBe(false);
  });

  it("limits members to conversations and reports", () => {
    expect(hasWorkspacePermission("MEMBER", "inbox:reply")).toBe(true);
    expect(hasWorkspacePermission("MEMBER", "reports:view")).toBe(true);
    expect(canManageAutomations("MEMBER")).toBe(false);
    expect(canManageInstagram("MEMBER")).toBe(false);
    expect(canManageMembers("MEMBER")).toBe(false);
  });

  it("prevents admins from creating or changing other admins", () => {
    expect(canAssignWorkspaceRole("ADMIN", "MEMBER")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageWorkspaceMember("ADMIN", "MEMBER")).toBe(true);
    expect(canManageWorkspaceMember("ADMIN", "ADMIN")).toBe(false);
    expect(canManageWorkspaceMember("ADMIN", "OWNER")).toBe(false);
  });

  it("allows owners to manage every non-owner role", () => {
    expect(canAssignWorkspaceRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignWorkspaceRole("OWNER", "MEMBER")).toBe(true);
    expect(canManageWorkspaceMember("OWNER", "ADMIN")).toBe(true);
    expect(canManageWorkspaceMember("OWNER", "MEMBER")).toBe(true);
    expect(canManageWorkspaceMember("OWNER", "OWNER")).toBe(false);
  });
});
