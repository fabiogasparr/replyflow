import { Prisma } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";
import {
  createFlowDefinition,
  readFlowDefinition,
  type FlowLayoutNode,
} from "@/lib/automations/flow-definition";

export class FlowLayoutError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly latest?: Awaited<ReturnType<typeof getAutomationFlowLayout>>
  ) {
    super(message);
    this.name = "FlowLayoutError";
  }
}

export async function getAutomationFlowLayout(input: {
  workspaceId: string;
  automationId: string;
}) {
  const automation = await prisma.automation.findFirst({
    where: { id: input.automationId, workspaceId: input.workspaceId },
    select: { id: true, flowDefinition: true, flowRevision: true },
  });
  if (!automation) {
    throw new FlowLayoutError("Campanha não encontrada", 404, "FLOW_NOT_FOUND");
  }

  const parsed = readFlowDefinition(automation.flowDefinition);
  return {
    automationId: automation.id,
    revision: automation.flowRevision,
    definition: parsed.definition,
    source: parsed.source,
  };
}

export async function updateAutomationFlowLayout(input: {
  workspaceId: string;
  automationId: string;
  actorUserId: string;
  revision: number;
  nodes: FlowLayoutNode[];
}) {
  const definition = createFlowDefinition(input.nodes);

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.automation.findFirst({
      where: { id: input.automationId, workspaceId: input.workspaceId },
      select: { id: true, flowDefinition: true, flowRevision: true },
    });
    if (!existing) {
      throw new FlowLayoutError("Campanha não encontrada", 404, "FLOW_NOT_FOUND");
    }
    if (existing.flowRevision !== input.revision) {
      const latest = readFlowDefinition(existing.flowDefinition);
      throw new FlowLayoutError(
        "O mapa foi organizado por outra pessoa. Carregue a versão mais recente antes de salvar novamente.",
        409,
        "FLOW_VERSION_CONFLICT",
        {
          automationId: existing.id,
          revision: existing.flowRevision,
          definition: latest.definition,
          source: latest.source,
        }
      );
    }

    const updated = await transaction.automation.updateMany({
      where: {
        id: input.automationId,
        workspaceId: input.workspaceId,
        flowRevision: input.revision,
      },
      data: {
        flowDefinition: definition as unknown as Prisma.InputJsonValue,
        flowRevision: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const latestAutomation = await transaction.automation.findFirst({
        where: { id: input.automationId, workspaceId: input.workspaceId },
        select: { id: true, flowDefinition: true, flowRevision: true },
      });
      const latestDefinition = latestAutomation
        ? readFlowDefinition(latestAutomation.flowDefinition)
        : null;
      throw new FlowLayoutError(
        "O mapa mudou durante o salvamento. Recarregue a versão mais recente.",
        409,
        "FLOW_VERSION_CONFLICT",
        latestAutomation && latestDefinition
          ? {
              automationId: latestAutomation.id,
              revision: latestAutomation.flowRevision,
              definition: latestDefinition.definition,
              source: latestDefinition.source,
            }
          : undefined
      );
    }

    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.automationFlowLayoutUpdated,
        targetType: "Automation",
        targetId: input.automationId,
        metadata: {
          schemaVersion: definition.schemaVersion,
          revision: input.revision + 1,
          nodeCount: definition.nodes.length,
        },
      }),
    });

    return {
      automationId: input.automationId,
      revision: input.revision + 1,
      definition,
      source: "stored" as const,
    };
  });
}
