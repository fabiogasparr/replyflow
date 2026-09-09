import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  getQueue: vi.fn(),
  workerHealth: vi.fn(),
  requestRetry: vi.fn(),
  workspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/platform-admin", () => ({ getPlatformAccess: mocks.access }));
vi.mock("@/lib/ops/platform-support", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ops/platform-support")>();
  return { ...original, getPlatformSupportQueue: mocks.getQueue };
});
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: mocks.workerHealth }));
vi.mock("@/lib/dm-retry-request", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/dm-retry-request")>();
  return { ...original, requestDmRetry: mocks.requestRetry };
});
vi.mock("@/lib/db/client", () => ({
  prisma: { workspace: { findUnique: mocks.workspaceFindUnique } },
}));

import { GET, POST } from "@/app/api/platform/support/route";
import { DmRetryRequestError } from "@/lib/dm-retry-request";

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/platform/support${query}`);
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/platform/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    authenticated: true,
    role: "ADMIN",
    admin: { id: "admin_1", name: "Suporte", email: "support@example.test" },
  });
  mocks.getQueue.mockResolvedValue({ incidents: [] });
  mocks.workerHealth.mockResolvedValue({ healthy: true });
  mocks.workspaceFindUnique.mockResolvedValue({
    id: "workspace_1",
    name: "Empresa Aurora",
    archivedAt: null,
  });
  mocks.requestRetry.mockResolvedValue({ id: "log_1", status: "PENDING" });
});

describe("/api/platform/support", () => {
  it("exige administrador global para leitura e escrita", async () => {
    mocks.access.mockResolvedValueOnce({ authenticated: false, role: null, admin: null });
    expect((await GET(getRequest())).status).toBe(401);

    mocks.access.mockResolvedValueOnce({ authenticated: true, role: "USER", admin: null });
    expect((await POST(postRequest({}))).status).toBe(403);
    expect(mocks.getQueue).not.toHaveBeenCalled();
    expect(mocks.requestRetry).not.toHaveBeenCalled();
  });

  it("valida filtros e entrega respostas privadas sem cache", async () => {
    expect((await GET(getRequest("?status=SENT"))).status).toBe(400);

    const response = await GET(getRequest("?status=FAILED&limit=10&q=Aurora"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getQueue).toHaveBeenCalledWith({
      status: "FAILED",
      limit: 10,
      q: "Aurora",
    });
  });

  it("exige o nome exato e bloqueia empresas arquivadas", async () => {
    const mismatch = await POST(
      postRequest({ workspaceId: "workspace_1", logId: "log_1", confirmation: "Outra" })
    );
    expect(mismatch.status).toBe(409);
    expect(mocks.workerHealth).not.toHaveBeenCalled();

    mocks.workspaceFindUnique.mockResolvedValueOnce({
      id: "workspace_1",
      name: "Empresa Aurora",
      archivedAt: new Date(),
    });
    const archived = await POST(
      postRequest({ workspaceId: "workspace_1", logId: "log_1", confirmation: "Empresa Aurora" })
    );
    expect(archived.status).toBe(409);
    expect(mocks.requestRetry).not.toHaveBeenCalled();
  });

  it("não altera o envio quando o worker está indisponível", async () => {
    mocks.workerHealth.mockResolvedValue({ healthy: false });

    const response = await POST(
      postRequest({ workspaceId: "workspace_1", logId: "log_1", confirmation: "Empresa Aurora" })
    );

    expect(response.status).toBe(409);
    expect(mocks.requestRetry).not.toHaveBeenCalled();
  });

  it("enfileira somente um log escopado e identifica o suporte na auditoria", async () => {
    const response = await POST(
      postRequest({ workspaceId: "workspace_1", logId: "log_1", confirmation: "Empresa Aurora" })
    );

    expect(response.status).toBe(202);
    expect(mocks.requestRetry).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      actorUserId: "admin_1",
      logId: "log_1",
      source: "PLATFORM_SUPPORT",
    });
  });

  it("preserva erros de concorrência e segurança do serviço compartilhado", async () => {
    mocks.requestRetry.mockRejectedValue(
      new DmRetryRequestError("Entrega ambígua", 409)
    );

    const response = await POST(
      postRequest({ workspaceId: "workspace_1", logId: "log_1", confirmation: "Empresa Aurora" })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "Entrega ambígua" });
  });
});
