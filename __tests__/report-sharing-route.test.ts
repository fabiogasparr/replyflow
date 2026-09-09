import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  getSharing: vi.fn(),
  updateBrand: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
}));
vi.mock("@/lib/reports/sharing", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/reports/sharing")>();
  return {
    ...original,
    getWorkspaceReportSharing: mocks.getSharing,
    updateWorkspaceReportBrand: mocks.updateBrand,
    publishCampaignReport: mocks.publish,
    revokeCampaignReport: mocks.revoke,
    rotateCampaignReportLink: mocks.rotate,
  };
});

import { GET, PATCH } from "@/app/api/reports/sharing/route";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/reports/sharing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    workspaceId: "workspace_1",
    userId: "user_1",
    role: "ADMIN",
  });
  mocks.getSharing.mockResolvedValue({ canManage: true, campaigns: [] });
  mocks.updateBrand.mockResolvedValue({ name: "Marca", color: "#112620" });
  mocks.publish.mockResolvedValue({ id: "automation_1", enabled: true });
  mocks.revoke.mockResolvedValue({ id: "automation_1", enabled: false });
  mocks.rotate.mockResolvedValue({ id: "automation_1", enabled: true });
});

describe("/api/reports/sharing", () => {
  it("exige autenticação e não armazena respostas privadas em cache", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getSharing).not.toHaveBeenCalled();
  });

  it("retorna configuração do workspace ativo", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.getSharing).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      role: "ADMIN",
    });
  });

  it("valida nome, cor e período antes de alterar dados", async () => {
    expect((await patch({ action: "update_brand", name: "", color: "red" })).status).toBe(400);
    expect((await patch({ action: "publish", automationId: "a", periodDays: 14 })).status).toBe(400);
    expect(mocks.updateBrand).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("encaminha publicação, revogação e renovação com o contexto autenticado", async () => {
    expect((await patch({ action: "publish", automationId: "a1", periodDays: 30 })).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "ADMIN",
      automationId: "a1",
      periodDays: 30,
    });

    expect((await patch({ action: "revoke", automationId: "a1" })).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({ automationId: "a1" }));

    expect((await patch({ action: "rotate", automationId: "a1" })).status).toBe(200);
    expect(mocks.rotate).toHaveBeenCalledWith(expect.objectContaining({ automationId: "a1" }));
  });
});
