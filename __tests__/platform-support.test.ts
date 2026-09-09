import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, getWorkerHealth } = vi.hoisted(() => ({
  prisma: {
    dmLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  getWorkerHealth: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma }));
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth }));

import { getPlatformSupportQueue } from "@/lib/ops/platform-support";

const candidate = {
  id: "log_1",
  workspaceId: "workspace_1",
  automationId: "automation_1",
  instagramAccountId: "account_1",
  commenterId: "person_private",
  commenterName: "maria_private",
  commentId: "comment_private",
  commentText: "conteúdo privado",
  matchedKeyword: "quero",
  status: "FAILED" as const,
  triggerType: "COMMENT" as const,
  sourceEventId: "event_1",
  sourceMediaId: "media_1",
  originalMediaId: null,
  source: "WEBHOOK",
  deliveryAttemptedAt: null,
  manualRetryCount: 0,
  lastManualRetryAt: null,
  attempts: 1,
  dmSentAt: null,
  errorMessage: "erro interno privado",
  publicReplySentAt: null,
  publicReplyError: null,
  createdAt: new Date("2026-09-09T10:00:00.000Z"),
  updatedAt: new Date("2026-09-09T10:05:00.000Z"),
  workspace: {
    id: "workspace_1",
    name: "Empresa Aurora",
    archivedAt: null,
  },
  automation: {
    id: "automation_1",
    name: "Catálogo",
    isActive: true,
    workspaceId: "workspace_1",
  },
  instagramAccount: {
    id: "account_1",
    username: "aurora",
    instagramId: "ig_1",
    tokenExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    workspaceId: "workspace_1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.dmLog.findMany.mockResolvedValue([candidate]);
  prisma.dmLog.count.mockResolvedValue(1);
  prisma.dmLog.findFirst.mockResolvedValue({ id: "log_1" });
  getWorkerHealth.mockResolvedValue({
    healthy: true,
    ageMs: 2_000,
    heartbeat: { checkedAt: "2026-09-09T10:05:00.000Z" },
  });
});

describe("fila global de suporte", () => {
  it("lista metadados operacionais sem expor conteúdo ou identidade do contato", async () => {
    const result = await getPlatformSupportQueue(
      { q: "Aurora", status: "ALL", limit: 20 },
      new Date("2026-09-09T10:06:00.000Z")
    );

    expect(prisma.dmLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: ["FAILED", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT"],
          },
          workspace: { archivedAt: null },
          OR: expect.any(Array),
        }),
        take: 21,
      })
    );
    expect(result.readiness).toMatchObject({
      queueAvailable: true,
      workerHealthy: true,
    });
    expect(result.incidents[0]).toMatchObject({
      id: "log_1",
      workspace: { id: "workspace_1", name: "Empresa Aurora" },
      automation: { id: "automation_1", name: "Catálogo" },
      status: "FAILED",
      retry: { allowed: true, reason: null },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("conteúdo privado");
    expect(serialized).not.toContain("maria_private");
    expect(serialized).not.toContain("person_private");
    expect(serialized).not.toContain("erro interno privado");
    expect(serialized).not.toContain("event_1");
  });

  it("remove relações corrompidas para impedir ações entre empresas", async () => {
    prisma.dmLog.findMany.mockResolvedValue([
      {
        ...candidate,
        automation: { ...candidate.automation, workspaceId: "workspace_other" },
      },
    ]);

    const result = await getPlatformSupportQueue({ status: "ALL", limit: 20 });

    expect(result.incidents).toEqual([]);
  });

  it("rejeita cursor fora dos filtros antes de carregar a página", async () => {
    prisma.dmLog.findFirst.mockResolvedValue(null);

    await expect(
      getPlatformSupportQueue({ status: "FAILED", cursor: "foreign", limit: 20 })
    ).rejects.toThrow("INVALID_CURSOR");
    expect(prisma.dmLog.findMany).not.toHaveBeenCalled();
  });

  it("fecha a trava operacional quando Redis não responde", async () => {
    getWorkerHealth.mockRejectedValue(new Error("redis down"));

    const result = await getPlatformSupportQueue({ status: "ALL", limit: 20 });

    expect(result.readiness).toEqual({
      queueAvailable: false,
      workerHealthy: false,
      workerAgeMs: null,
      lastSeenAt: null,
    });
  });
});
