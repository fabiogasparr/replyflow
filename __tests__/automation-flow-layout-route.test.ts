import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  getLayout: vi.fn(),
  updateLayout: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
  canManageAutomations: mocks.permission,
}));
vi.mock("@/lib/automations/flow-layout", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/automations/flow-layout")
  >();
  return {
    ...original,
    getAutomationFlowLayout: mocks.getLayout,
    updateAutomationFlowLayout: mocks.updateLayout,
  };
});

import { GET, PATCH } from "@/app/api/automations/[id]/flow/route";
import { createDefaultFlowDefinition } from "@/lib/automations/flow-definition";
import { FlowLayoutError } from "@/lib/automations/flow-layout";

const definition = createDefaultFlowDefinition();
const context = {
  userId: "user_1",
  workspaceId: "workspace_1",
  role: "ADMIN",
  workspace: { id: "workspace_1", name: "Empresa Aurora" },
};

function route(id = "automation_1") {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/automations/automation_1/flow", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.permission.mockReturnValue(true);
  mocks.getLayout.mockResolvedValue({
    automationId: "automation_1",
    revision: 0,
    definition,
    source: "default",
  });
  mocks.updateLayout.mockResolvedValue({
    automationId: "automation_1",
    revision: 1,
    definition,
    source: "stored",
  });
});

describe("/api/automations/[id]/flow", () => {
  it("exige autenticação antes de ler ou escrever", async () => {
    mocks.context.mockResolvedValue(null);

    expect(
      (await GET(new NextRequest("http://localhost/api/automations/a/flow"), route())).status
    ).toBe(401);
    expect((await PATCH(patchRequest({}), route())).status).toBe(401);
    expect(mocks.getLayout).not.toHaveBeenCalled();
    expect(mocks.updateLayout).not.toHaveBeenCalled();
  });

  it("permite leitura isolada para integrantes e responde sem cache", async () => {
    mocks.permission.mockReturnValue(false);

    const response = await GET(
      new NextRequest("http://localhost/api/automations/automation_1/flow"),
      route()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: { canManage: false },
    });
    expect(mocks.getLayout).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      automationId: "automation_1",
    });
  });

  it("bloqueia escrita para perfil sem permissão", async () => {
    mocks.permission.mockReturnValue(false);

    const response = await PATCH(
      patchRequest({ revision: 0, nodes: definition.nodes }),
      route()
    );

    expect(response.status).toBe(403);
    expect(mocks.updateLayout).not.toHaveBeenCalled();
  });

  it("rejeita topologia malformada antes de chamar o serviço", async () => {
    const response = await PATCH(
      patchRequest({ revision: 0, nodes: definition.nodes.slice(0, 5) }),
      route()
    );

    expect(response.status).toBe(400);
    expect(mocks.updateLayout).not.toHaveBeenCalled();
  });

  it("persiste com workspace, ator e revisão explícitos", async () => {
    const response = await PATCH(
      patchRequest({ revision: 0, nodes: definition.nodes }),
      route()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.updateLayout).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      automationId: "automation_1",
      actorUserId: "user_1",
      revision: 0,
      nodes: definition.nodes,
    });
  });

  it("expõe a versão vencedora quando há conflito de concorrência", async () => {
    mocks.updateLayout.mockRejectedValue(
      new FlowLayoutError(
        "O mapa mudou",
        409,
        "FLOW_VERSION_CONFLICT",
        {
          automationId: "automation_1",
          revision: 2,
          definition,
          source: "stored",
        }
      )
    );

    const response = await PATCH(
      patchRequest({ revision: 1, nodes: definition.nodes }),
      route()
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "FLOW_VERSION_CONFLICT",
      latest: { revision: 2 },
    });
  });
});
