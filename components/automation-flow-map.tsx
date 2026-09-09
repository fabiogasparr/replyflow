"use client";

import { useMemo, useState } from "react";
import type {
  AutomationFlowMap as AutomationFlowMapData,
  AutomationFlowNode,
  AutomationFlowNodeId,
  AutomationFlowNodeKind,
} from "@/lib/automations/flow-map";

interface AutomationFlowMapProps {
  flow: AutomationFlowMapData;
  onToggleNode: (nodeId: AutomationFlowNodeId) => void;
  onEditNode: (nodeId: AutomationFlowNodeId) => void;
}

const kindMeta: Record<
  AutomationFlowNodeKind,
  { label: string; accent: string; icon: React.ReactNode }
> = {
  trigger: {
    label: "Gatilho",
    accent: "#ff6b4a",
    icon: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  },
  action: {
    label: "Ação",
    accent: "#1d7a5d",
    icon: <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm8-4.5v9m8-4.5-8 4.5m-8-4.5 8 4.5" />,
  },
  condition: {
    label: "Condição",
    accent: "#b87913",
    icon: <path d="m12 3 8 9-8 9-8-9 8-9Zm-3 9h6" />,
  },
  wait: {
    label: "Espera",
    accent: "#496a8a",
    icon: <path d="M7 3h10M7 21h10M8 3c0 5 2 6 4 9-2 3-4 4-4 9m8-18c0 5-2 6-4 9 2 3 4 4 4 9" />,
  },
};

function FlowIcon({ node }: { node: AutomationFlowNode }) {
  const meta = kindMeta[node.kind];
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-white"
      style={{ color: meta.accent, borderColor: `${meta.accent}38` }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.8]"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {meta.icon}
      </svg>
    </span>
  );
}
function FlowNodeCard({
  node,
  selected,
  onSelect,
}: {
  node: AutomationFlowNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = kindMeta[node.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative w-[196px] shrink-0 rounded-2xl border p-3.5 text-left shadow-[0_10px_30px_rgba(17,38,32,0.06)] transition duration-200 ${
        selected
          ? "-translate-y-1 border-[#112620] bg-white shadow-[0_16px_34px_rgba(17,38,32,0.14)]"
          : node.enabled
            ? "border-[#d5cbbb] bg-[#fffdf8] hover:-translate-y-0.5 hover:border-[#9d9180]"
            : "border-dashed border-[#cfc6b8] bg-[#f3eee4]/80 opacity-75 hover:opacity-100"
      }`}
    >
      <span
        className="absolute inset-x-4 top-0 h-0.5 rounded-b-full"
        style={{ backgroundColor: node.enabled ? meta.accent : "#b8afa1" }}
      />
      <span className="flex items-start justify-between gap-3">
        <FlowIcon node={node} />
        <span
          className={`mt-0.5 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
            !node.enabled
              ? "bg-[#e9e2d7] text-[#746d63]"
              : node.complete
                ? "bg-[#dff0e8] text-[#17664e]"
                : "bg-[#fff0d7] text-[#8c5c0c]"
          }`}
        >
          {!node.enabled ? "Opcional" : node.complete ? "Pronta" : "Revisar"}
        </span>
      </span>
      <span className="mt-4 block text-[10px] font-bold uppercase tracking-[0.17em] text-[#7b766e]">
        {node.eyebrow}
      </span>
      <span className="mt-1 block text-sm font-bold text-[#112620]">{node.title}</span>
      <span className="mt-2 block min-h-12 text-[11px] leading-[1.45] text-[#66736e]">
        {node.summary}
      </span>
    </button>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center" aria-hidden="true">
      <span className="mb-1 text-[8px] font-bold uppercase tracking-[0.12em] text-[#8c857a]">
        {label}
      </span>
      <span className="flex w-full items-center">
        <span className="h-px flex-1 bg-[#bdb3a4]" />
        <span className="-ml-1 h-2 w-2 rotate-45 border-r border-t border-[#7d7467]" />
      </span>
    </div>
  );
}

export default function AutomationFlowMap({
  flow,
  onToggleNode,
  onEditNode,
}: AutomationFlowMapProps) {
  const [selectedId, setSelectedId] =
    useState<AutomationFlowNodeId>("trigger");
  const nodeById = useMemo(
    () => new Map(flow.nodes.map((node) => [node.id, node])),
    [flow.nodes]
  );
  const selected = nodeById.get(selectedId) ?? flow.nodes[0];
  const mainNodes = ["trigger", "opening-dm", "follow-gate", "delivery", "follow-up"]
    .map((id) => nodeById.get(id as AutomationFlowNodeId))
    .filter((node): node is AutomationFlowNode => Boolean(node));
  const publicReply = nodeById.get("public-reply");

  return (
    <section
      aria-label="Mapa visual da automação"
      className="overflow-hidden rounded-[24px] border border-[#cfc5b5] bg-[#ece4d8] shadow-[0_18px_60px_rgba(17,38,32,0.08)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d0c6b7] bg-[#112620] px-5 py-4 text-white sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5c451]">
            Arquitetura da conversa
          </p>
          <h2 className="mt-1 font-display text-xl">Do primeiro sinal à próxima ação.</h2>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-[#b8c7c1]">
          <span>
            <strong className="text-white">{flow.configuredSteps}</strong> de {flow.activeSteps} etapas prontas
          </span>
          <span className="h-4 w-px bg-white/15" />
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${flow.warnings.length ? "bg-[#f5c451]" : "bg-[#6ed1a9]"}`} />
            {flow.warnings.length ? `${flow.warnings.length} pendência${flow.warnings.length > 1 ? "s" : ""}` : "Fluxo consistente"}
          </span>
        </div>
      </div>

      <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="brand-grid overflow-x-auto border-b border-[#d0c6b7] bg-[#f7f2e9] lg:border-b-0 lg:border-r">
          <div className="min-w-[1120px] px-8 py-12">
            <div className="flex items-center">
              {mainNodes.map((node, index) => (
                <div key={node.id} className="flex items-center">
                  {index > 0 && (
                    <Connector
                      label={
                        node.id === "delivery" && nodeById.get("follow-gate")?.enabled
                          ? "se sim"
                          : node.id === "follow-up"
                            ? "depois"
                            : "continuar"
                      }
                    />
                  )}
                  <FlowNodeCard
                    node={node}
                    selected={selected.id === node.id}
                    onSelect={() => setSelectedId(node.id)}
                  />
                </div>
              ))}
            </div>

            {publicReply && (
              <div className="ml-[34px] mt-1 flex items-start">
                <div className="ml-[62px] flex w-[100px] flex-col items-center" aria-hidden="true">
                  <span className="h-8 w-px bg-[#bdb3a4]" />
                  <span className="mb-1 text-[8px] font-bold uppercase tracking-[0.12em] text-[#8c857a]">
                    no post
                  </span>
                  <span className="h-5 w-px bg-[#bdb3a4]" />
                  <span className="-mt-1 h-2 w-2 rotate-[135deg] border-r border-t border-[#7d7467]" />
                </div>
                <div className="-ml-[148px] mt-[58px]">
                  <FlowNodeCard
                    node={publicReply}
                    selected={selected.id === publicReply.id}
                    onSelect={() => setSelectedId(publicReply.id)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="bg-[#fffdf8] p-5 sm:p-6" aria-live="polite">
          <div className="flex items-center gap-3">
            <FlowIcon node={selected} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                {kindMeta[selected.kind].label}
              </p>
              <h3 className="text-base font-bold text-foreground">{selected.title}</h3>
            </div>
          </div>

          <p className="mt-5 text-sm leading-6 text-muted">{selected.summary}</p>

          <div className="mt-5 rounded-xl border border-border bg-surface/65 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-foreground">Estado da etapa</span>
              <span
                className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
                  !selected.enabled
                    ? "bg-[#e6ded2] text-[#746d63]"
                    : selected.complete
                      ? "bg-success/10 text-success"
                      : "bg-warning/10 text-warning"
                }`}
              >
                {!selected.enabled ? "Desativada" : selected.complete ? "Configurada" : "Incompleta"}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              {selected.enabled && !selected.complete
                ? "Existem campos obrigatórios pendentes nesta etapa."
                : selected.optional
                  ? "Esta etapa pode ser ligada ou removida sem apagar o conteúdo preenchido."
                  : "Esta etapa é essencial para a automação funcionar."}
            </p>
          </div>

          <div className="mt-6 space-y-2.5">
            <button
              type="button"
              onClick={() => onEditNode(selected.id)}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-accent-hover"
            >
              Editar conteúdo
            </button>
            {selected.optional && (
              <button
                type="button"
                onClick={() => onToggleNode(selected.id)}
                className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm font-semibold text-foreground transition hover:border-border-hover hover:bg-surface"
              >
                {selected.enabled ? "Desativar etapa" : "Adicionar ao fluxo"}
              </button>
            )}
          </div>

          <div className="mt-7 border-t border-border pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Contrato de execução
            </p>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              O mapa usa o mesmo motor já validado no worker. Alterações só entram em produção quando você salvar ou ativar a campanha.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
