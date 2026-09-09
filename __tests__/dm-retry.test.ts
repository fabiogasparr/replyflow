import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  queueAdd: vi.fn(),
  prisma: {
    dmLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
}));
vi.mock("@/lib/workspace-permissions", () => ({
  canManageAutomations: mocks.permission,
}));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queue/client")>();
  return {
    ...original,
    getDMQueue: () => ({ add: mocks.queueAdd }),
  };
});

import { POST } from "@/app/api/logs/[id]/retry/route";
import { GET as listLogs } from "@/app/api/logs/route";
import {
  buildDmRetryJob,
  getDmRetryEligibility,
  type DmRetryCandidate,
} from "@/lib/dm-retry";

const workspace = {
  userId: "user_1",
  workspaceId: "workspace_1",
  role: "ADMIN" as const,
  workspace: { id: "workspace_1", name: "Empresa" },
};

const candidate: DmRetryCandidate = {
  id: "log_1",
  automationId: "automation_1",
  commenterId: "person_1",
  commenterName: "maria",
  commentId: "comment_1",
  commentText: "quero",
  matchedKeyword: "quero",
  status: "SKIPPED_RATE_LIMIT",
  triggerType: "COMMENT",
  sourceEventId: "comment_1",
  sourceMediaId: "media_1",
  originalMediaId: null,
  deliveryAttemptedAt: null,
  manualRetryCount: 0,
  lastManualRetryAt: null,
  automation: { isActive: true },
  instagramAccount: { instagramId: "ig_business_1" },
};

function request() {
  return new NextRequest("http://localhost/api/logs/log_1/retry", {
    method: "POST",
  });
}

function route(id = "log_1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(workspace);
  mocks.permission.mockReturnValue(true);
  mocks.prisma.dmLog.findFirst.mockResolvedValue(candidate);
  mocks.prisma.dmLog.findMany.mockResolvedValue([]);
  mocks.prisma.dmLog.count.mockResolvedValue(0);
  mocks.prisma.dmLog.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  mocks.queueAdd.mockResolvedValue({ id: "job_1" });
});

describe("DM retry eligibility", () => {
  it("allows only pre-delivery operational failures", () => {
    expect(getDmRetryEligibility(candidate).allowed).toBe(true);
    expect(
      getDmRetryEligibility({
        ...candidate,
        status: "FAILED",
        deliveryAttemptedAt: new Date(),
      })
    ).toEqual({
      allowed: false,
      reason:
        "A entrega já foi iniciada na Meta. O reenvio foi bloqueado para evitar uma mensagem duplicada.",
    });
  });

  it("rebuilds a targeted comment job from immutable log metadata", () => {
    expect(buildDmRetryJob(candidate)).toEqual({
      name: "process-comment",
      data: {
        automationId: "automation_1",
        instagramAccountId: "ig_business_1",
        commentId: "comment_1",
        commentText: "quero",
        commenterId: "person_1",
        commenterName: "maria",
        matchedKeyword: "quero",
        mediaId: "media_1",
        source: "MANUAL",
      },
    });
  });

  it("blocks old any-post rows without their source media", () => {
    expect(
      getDmRetryEligibility({ ...candidate, sourceMediaId: null })
    ).toEqual({
      allowed: false,
      reason:
        "A publicação de origem não está disponível para este registro antigo.",
    });
  });

  it("blocks archived workspaces and expired Instagram credentials", () => {
    expect(
      getDmRetryEligibility({
        ...candidate,
        workspace: { archivedAt: new Date("2026-09-01T00:00:00.000Z") },
      })
    ).toEqual({
      allowed: false,
      reason: "A empresa está arquivada e não pode processar novos envios.",
    });
    expect(
      getDmRetryEligibility(
        {
          ...candidate,
          instagramAccount: {
            ...candidate.instagramAccount,
            tokenExpiresAt: new Date("2026-09-08T00:00:00.000Z"),
          },
        },
        new Date("2026-09-09T00:00:00.000Z")
      )
    ).toEqual({
      allowed: false,
      reason: "Reconecte a conta do Instagram antes de reprocessar este envio.",
    });
  });
});

describe("POST /api/logs/:id/retry", () => {
  it("requires authentication and management permission", async () => {
    mocks.context.mockResolvedValueOnce(null);
    const unauthenticated = await POST(request(), route());
    expect(unauthenticated.status).toBe(401);
    expect(mocks.prisma.dmLog.findFirst).not.toHaveBeenCalled();

    mocks.context.mockResolvedValueOnce({ ...workspace, role: "MEMBER" });
    mocks.permission.mockReturnValueOnce(false);
    const forbidden = await POST(request(), route());
    expect(forbidden.status).toBe(403);
  });

  it("looks up the log through all tenant relationships", async () => {
    mocks.prisma.dmLog.findFirst.mockResolvedValueOnce(null);
    const response = await POST(request(), route("foreign_log"));

    expect(response.status).toBe(404);
    expect(mocks.prisma.dmLog.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign_log",
        workspaceId: "workspace_1",
        workspace: { id: "workspace_1", archivedAt: null },
        automation: { workspaceId: "workspace_1" },
        instagramAccount: { workspaceId: "workspace_1" },
      },
      include: {
        workspace: { select: { archivedAt: true } },
        automation: { select: { isActive: true } },
        instagramAccount: {
          select: { instagramId: true, tokenExpiresAt: true },
        },
      },
    });
  });

  it("reserves the row, queues one targeted retry and audits without content", async () => {
    const response = await POST(request(), route());
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.data).toMatchObject({
      id: "log_1",
      status: "PENDING",
      manualRetryCount: 1,
    });
    expect(mocks.prisma.dmLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "log_1",
          workspaceId: "workspace_1",
          status: "SKIPPED_RATE_LIMIT",
          manualRetryCount: 0,
          deliveryAttemptedAt: null,
        }),
        data: expect.objectContaining({
          status: "PENDING",
          manualRetryCount: { increment: 1 },
        }),
      })
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        automationId: "automation_1",
        commentId: "comment_1",
      }),
      { jobId: "manual_retry_log_1_1" }
    );
    expect(mocks.prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        actorUserId: "user_1",
        action: "DM_RETRY_REQUESTED",
        targetId: "log_1",
        metadata: {
          triggerType: "COMMENT",
          retryNumber: 1,
          requestedVia: "WORKSPACE",
        },
      }),
    });
  });

  it("returns a conflict when another process reserved the row", async () => {
    mocks.prisma.dmLog.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await POST(request(), route());
    expect(response.status).toBe(409);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("restores the status when Redis cannot accept the job", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("redis unavailable"));
    const response = await POST(request(), route());

    expect(response.status).toBe(503);
    expect(mocks.prisma.dmLog.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.dmLog.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "log_1",
          workspaceId: "workspace_1",
          status: "PENDING",
          manualRetryCount: 1,
          deliveryAttemptedAt: null,
        }),
        data: {
          status: "SKIPPED_RATE_LIMIT",
          manualRetryCount: 0,
          lastManualRetryAt: null,
        },
      })
    );
  });
});

describe("GET /api/logs", () => {
  it("scopes filters and exposes server-side retry decisions", async () => {
    mocks.prisma.dmLog.findMany.mockResolvedValueOnce([
      {
        ...candidate,
        automation: { ...candidate.automation, name: "Campanha", keywords: ["quero"] },
        instagramAccount: {
          ...candidate.instagramAccount,
          username: "empresa",
        },
      },
    ]);
    mocks.prisma.dmLog.count.mockResolvedValueOnce(1);

    const response = await listLogs(
      new NextRequest(
        "http://localhost/api/logs?page=invalid&limit=999&status=SKIPPED_RATE_LIMIT&instagramAccountId=account_1"
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.prisma.dmLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace_1",
          status: "SKIPPED_RATE_LIMIT",
          instagramAccountId: "account_1",
        },
        skip: 0,
        take: 50,
      })
    );
    expect(payload.data).toMatchObject({
      canManageRetries: true,
      logs: [{ id: "log_1", retry: { allowed: true, reason: null } }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
  });
});
