import { describe, expect, it } from "vitest";
import {
  buildAutomationFlow,
  type AutomationFlowSource,
} from "@/lib/automations/flow-map";

function source(
  overrides: Partial<AutomationFlowSource> = {}
): AutomationFlowSource {
  return {
    triggerScope: "specific",
    postSelected: true,
    matchMode: "specific",
    keywords: ["quero"],
    dmTriggerEnabled: false,
    publicReplyEnabled: false,
    publicReplyMessages: [""],
    openingDmEnabled: false,
    openingDmMessage: "",
    openingDmButtonLabel: "",
    requireFollow: false,
    followPromptMessage: "",
    followPromptButtonLabel: "",
    dmMessage: "Aqui está o conteúdo {link}",
    primaryLinkEnabled: true,
    secondaryLinkEnabled: false,
    followUpEnabled: false,
    followUpMessage: "",
    followUpDelayMinutes: 0,
    ...overrides,
  };
}

describe("mapa visual da automação", () => {
  it("projeta o fluxo mínimo sem inventar etapas de execução", () => {
    const flow = buildAutomationFlow(source());

    expect(flow.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "public-reply",
      "opening-dm",
      "follow-gate",
      "delivery",
      "follow-up",
    ]);
    expect(flow.activeSteps).toBe(2);
    expect(flow.configuredSteps).toBe(2);
    expect(flow.warnings).toEqual([]);
    expect(flow.connections).toContainEqual({
      from: "trigger",
      to: "public-reply",
      label: "no comentário",
      branch: "side",
    });
  });

  it("marca somente etapas habilitadas e incompletas para revisão", () => {
    const flow = buildAutomationFlow(
      source({
        publicReplyEnabled: true,
        publicReplyMessages: ["", "  "],
        openingDmEnabled: true,
        openingDmMessage: "Olá",
        openingDmButtonLabel: "",
        followUpEnabled: true,
        followUpMessage: "Obrigado!",
      })
    );

    expect(flow.warnings).toEqual([
      "Revise a etapa “Responder no post”.",
      "Revise a etapa “Iniciar conversa”.",
    ]);
    expect(flow.activeSteps).toBe(5);
    expect(flow.configuredSteps).toBe(3);
  });

  it("explica entradas por comentário e DM e resume os dois links", () => {
    const flow = buildAutomationFlow(
      source({
        triggerScope: "any",
        postSelected: false,
        matchMode: "any",
        keywords: [],
        dmTriggerEnabled: true,
        secondaryLinkEnabled: true,
      })
    );

    expect(flow.nodes.find((node) => node.id === "trigger")?.summary).toBe(
      "Comentário em qualquer publicação, com qualquer palavra, ou mensagem recebida."
    );
    expect(flow.nodes.find((node) => node.id === "delivery")?.summary).toBe(
      "Mensagem privada com 2 botões rastreáveis."
    );
  });

  it("mantém o gatilho incompleto enquanto publicação ou palavra estiverem pendentes", () => {
    const flow = buildAutomationFlow(
      source({ postSelected: false, keywords: [] })
    );

    expect(flow.nodes.find((node) => node.id === "trigger")?.complete).toBe(false);
    expect(flow.warnings).toEqual(["Revise a etapa “Comentário recebido”."]);
  });
});
