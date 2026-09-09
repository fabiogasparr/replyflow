import type { WorkspaceRole } from "@/app/generated/prisma/client";

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export type WorkspacePermission =
  | "workspace:update"
  | "workspace:archive"
  | "members:manage"
  | "instagram:manage"
  | "automations:manage"
  | "contacts:manage"
  | "inbox:reply"
  | "reports:view"
  | "reports:manage"
  | "billing:manage";

const WORKSPACE_PERMISSIONS: Record<
  WorkspaceRole,
  ReadonlySet<WorkspacePermission>
> = {
  OWNER: new Set([
    "workspace:update",
    "workspace:archive",
    "members:manage",
    "instagram:manage",
    "automations:manage",
    "contacts:manage",
    "inbox:reply",
    "reports:view",
    "reports:manage",
    "billing:manage",
  ]),
  ADMIN: new Set([
    "workspace:update",
    "members:manage",
    "instagram:manage",
    "automations:manage",
    "contacts:manage",
    "inbox:reply",
    "reports:view",
    "reports:manage",
  ]),
  MEMBER: new Set(["inbox:reply", "reports:view"]),
};

export function hasWorkspaceRole(
  role: WorkspaceRole,
  minimumRole: WorkspaceRole
) {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
}

export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermission
) {
  return WORKSPACE_PERMISSIONS[role].has(permission);
}

export function canManageWorkspace(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "workspace:update");
}

export function canManageBilling(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "billing:manage");
}

export function canManageAutomations(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "automations:manage");
}

export function canManageContacts(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "contacts:manage");
}

export function canManageInstagram(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "instagram:manage");
}

export function canManageMembers(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "members:manage");
}

export function canArchiveWorkspace(role: WorkspaceRole) {
  return hasWorkspacePermission(role, "workspace:archive");
}

export function canAssignWorkspaceRole(
  actorRole: WorkspaceRole,
  assignedRole: Exclude<WorkspaceRole, "OWNER">
) {
  if (actorRole === "OWNER") return true;
  return actorRole === "ADMIN" && assignedRole === "MEMBER";
}

export function canManageWorkspaceMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole
) {
  if (targetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  return actorRole === "ADMIN" && targetRole === "MEMBER";
}
