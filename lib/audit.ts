import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

export const AUDIT_ACTIONS = {
  workspaceCreated: "WORKSPACE_CREATED",
  workspaceRenamed: "WORKSPACE_RENAMED",
  workspaceArchived: "WORKSPACE_ARCHIVED",
  workspaceRestored: "WORKSPACE_RESTORED",
  memberInvited: "MEMBER_INVITED",
  invitationAccepted: "INVITATION_ACCEPTED",
  invitationRenewed: "INVITATION_RENEWED",
  invitationRevoked: "INVITATION_REVOKED",
  memberAdded: "MEMBER_ADDED",
  memberRoleChanged: "MEMBER_ROLE_CHANGED",
  memberRemoved: "MEMBER_REMOVED",
  instagramConnected: "INSTAGRAM_CONNECTED",
  instagramDisconnected: "INSTAGRAM_DISCONNECTED",
  contactUpdated: "CONTACT_UPDATED",
  contactDataExported: "CONTACT_DATA_EXPORTED",
  contactDataAnonymized: "CONTACT_DATA_ANONYMIZED",
  contactFieldCreated: "CONTACT_FIELD_CREATED",
  contactFieldUpdated: "CONTACT_FIELD_UPDATED",
  conversationUpdated: "CONVERSATION_UPDATED",
  conversationMessageSent: "CONVERSATION_MESSAGE_SENT",
  dmRetryRequested: "DM_RETRY_REQUESTED",
  supportDmRetryRequested: "SUPPORT_DM_RETRY_REQUESTED",
  automationFlowLayoutUpdated: "AUTOMATION_FLOW_LAYOUT_UPDATED",
  reportBrandUpdated: "REPORT_BRAND_UPDATED",
  reportPublished: "REPORT_PUBLISHED",
  reportRevoked: "REPORT_REVOKED",
  reportLinkRotated: "REPORT_LINK_ROTATED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditEventInput = {
  workspaceId: string;
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export function createAuditEventData(input: AuditEventInput) {
  return {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export async function recordAuditEvent(input: AuditEventInput) {
  return prisma.auditEvent.create({
    data: createAuditEventData(input),
  });
}
