import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    automation: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      automation: { findFirst: vi.fn() },
      $transaction: vi.fn(
        (callback: (value: typeof transaction) => unknown) => callback(transaction)
      ),
    },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));

import {
  FLOW_CANONICAL_EDGES,
  FLOW_NODE_IDS,
  createDefaultFlowDefinition,
  createFlowDefinition,
  flowLayoutUpdateSchema,
  readFlowDefinition,
} from "@/lib/automations/flow-definition";
import {
  getAutomationFlowLayout,
  updateAutomationFlowLayout,
} from "@/lib/automations/flow-layout";

const defaultDefinition = createDefaultFlowDefinition();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.automation.findFirst.mockResolvedValue({
    id: "automation_1",
    flowDefinition: defaultDefinition,
    flowRevision: 3,
  });
  mocks.transaction.automation.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.auditEvent.create.mockResolvedValue({});
});

describe("contrato versionado do mapa visual", () => {
  it("entrega o layout canônico para campanhas ainda não migradas", () => {
    const parsed = readFlowDefinition(null);

    expect(parsed.source).toBe("default");
    expect(parsed.definition.nodes.map((node) => node.id)).toEqual(FLOW_NODE_IDS);
    expect(parsed.definition.edges).toEqual(FLOW_CANONICAL_EDGES);
  });

  it("recupera com segurança uma versão ou topologia desconhecida", () => {
    const parsed = readFlowDefinition({
      ...defaultDefinition,
      schemaVersion: 2,
      edges: [],
    });

    expect(parsed.source).toBe("recovered");
    expect(parsed.definition).toEqual(defaultDefinition);
  });

  it("rejeita nós duplicados, ausentes e coordenadas fora do canvas", () => {
    const duplicated = defaultDefinition.nodes.map((node, index) =>
      index === 1 ? { ...node, id: "trigger" as const } : node
    );
    const outside = defaultDefinition.nodes.map((node) =>
      node.id === "trigger" ? { ...node, x: 50_000 } : node
    );

    expect(
      flowLayoutUpdateSchema.safeParse({ revision: 0, nodes: duplicated }).success
    ).toBe(false);
    expect(
      flowLayoutUpdateSchema.safeParse({ revision: 0, nodes: outside }).success
    ).toBe(false);
    expect(() => createFlowDefinition(duplicated)).toThrow();
  });

  it("normaliza a ordem e restaura somente as arestas canônicas", () => {
    const definition = createFlowDefinition([...defaultDefinition.nodes].reverse());

    expect(definition.nodes.map((node) => node.id)).toEqual(FLOW_NODE_IDS);
    expect(definition.edges).toEqual(FLOW_CANONICAL_EDGES);
  });
});

describe("persistência isolada do mapa visual", () => {
  it("lê a campanha somente dentro do workspace atual", async () => {
    mocks.prisma.automation.findFirst.mockResolvedValue({
      id: "automation_1",
      flowDefinition: null,
      flowRevision: 0,
    });

    await expect(
      getAutomationFlowLayout({
        workspaceId: "workspace_1",
        automationId: "automation_1",
      })
    ).resolves.toMatchObject({ revision: 0, source: "default" });
    expect(mocks.prisma.automation.findFirst).toHaveBeenCalledWith({
      where: { id: "automation_1", workspaceId: "workspace_1" },
      select: { id: true, flowDefinition: true, flowRevision: true },
    });
  });

  it("salva por revisão, workspace e registra auditoria sem conteúdo", async () => {
    const moved = defaultDefinition.nodes.map((node) =>
      node.id === "delivery" ? { ...node, y: node.y + 20 } : node
    );

    const result = await updateAutomationFlowLayout({
      workspaceId: "workspace_1",
      automationId: "automation_1",
      actorUserId: "user_1",
      revision: 3,
      nodes: moved,
    });

    expect(result).toMatchObject({ revision: 4, source: "stored" });
    expect(mocks.transaction.automation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "automation_1",
        workspaceId: "workspace_1",
        flowRevision: 3,
      },
      data: {
        flowDefinition: expect.objectContaining({ schemaVersion: 1 }),
        flowRevision: { increment: 1 },
      },
    });
    expect(mocks.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        actorUserId: "user_1",
        action: "AUTOMATION_FLOW_LAYOUT_UPDATED",
        targetId: "automation_1",
        metadata: { schemaVersion: 1, revision: 4, nodeCount: 6 },
      }),
    });
  });

  it("devolve a versão atual e não sobrescreve uma revisão antiga", async () => {
    mocks.transaction.automation.findFirst.mockResolvedValue({
      id: "automation_1",
      flowDefinition: defaultDefinition,
      flowRevision: 4,
    });

    await expect(
      updateAutomationFlowLayout({
        workspaceId: "workspace_1",
        automationId: "automation_1",
        actorUserId: "user_1",
        revision: 3,
        nodes: defaultDefinition.nodes,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "FLOW_VERSION_CONFLICT",
      latest: expect.objectContaining({ revision: 4 }),
    });
    expect(mocks.transaction.automation.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("detecta uma corrida no update condicional e recupera o layout vencedor", async () => {
    mocks.transaction.automation.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.automation.findFirst
      .mockResolvedValueOnce({
        id: "automation_1",
        flowDefinition: defaultDefinition,
        flowRevision: 3,
      })
      .mockResolvedValueOnce({
        id: "automation_1",
        flowDefinition: defaultDefinition,
        flowRevision: 4,
      });

    await expect(
      updateAutomationFlowLayout({
        workspaceId: "workspace_1",
        automationId: "automation_1",
        actorUserId: "user_1",
        revision: 3,
        nodes: defaultDefinition.nodes,
      })
    ).rejects.toMatchObject({
      status: 409,
      latest: expect.objectContaining({ revision: 4 }),
    });
    expect(mocks.transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
