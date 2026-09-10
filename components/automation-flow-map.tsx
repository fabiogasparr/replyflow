"use client";

import { useMemo, useState } from "react";
import type {
  AutomationFlowMap as AutomationFlowMapData,
  AutomationFlowNode,
  AutomationFlowNodeId,
  AutomationFlowNodeKind,
} from "@/lib/automations/flow-map";
import {
  FLOW_CANVAS_HEIGHT,
  FLOW_CANVAS_WIDTH,
  type FlowDefinitionV1,
  type FlowLayoutNode,
} from "@/lib/automations/flow-definition";

type LayoutState =
  | "idle"
  | "loading"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

interface AutomationFlowMapProps {
  flow: AutomationFlowMapData;
  layout: FlowDefinitionV1;
  layoutState: LayoutState;
  layoutMessage: string | null;
  isExisting: boolean;
  canPersist: boolean;
  onLayoutChange: (layout: FlowDefinitionV1) => void;
  onSaveLayout: () => void;
  onToggleNode: (nodeId: AutomationFlowNodeId) => void;
  onEditNode: (nodeId: AutomationFlowNodeId) => void;
}

const CARD_WIDTH = 196;
const CARD_HEIGHT = 180;
const POSITION_STEP = 20;

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

function clampPosition(node: FlowLayoutNode): FlowLayoutNode {
  return {
    ...node,
    x: Math.max(0, Math.min(FLOW_CANVAS_WIDTH - CARD_WIDTH, Math.round(node.x))),
    y: Math.max(0, Math.min(FLOW_CANVAS_HEIGHT - CARD_HEIGHT, Math.round(node.y))),
  };
}

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
      className={`group relative h-[180px] w-[196px] rounded-2xl border p-3.5 text-left shadow-[0_10px_30px_rgba(17,38,32,0.06)] transition duration-200 ${
        selected
          ? "border-[#112620] bg-white shadow-[0_16px_34px_rgba(17,38,32,0.14)]"
          : node.enabled
            ? "border-[#d5cbbb] bg-[#fffdf8] hover:border-[#9d9180]"
            : "border-dashed border-[#cfc6b8] bg-[#f3eee4]/90 opacity-75 hover:opacity-100"
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
      <span className="mt-2 line-clamp-3 block text-[11px] leading-[1.45] text-[#66736e]">
        {node.summary}
      </span>
    </button>
  );
}

function connectionPath(from: FlowLayoutNode, to: FlowLayoutNode, side: boolean) {
  if (side) {
    const startX = from.x + CARD_WIDTH / 2;
    const startY = from.y + CARD_HEIGHT;
    const endX = to.x + CARD_WIDTH / 2;
    const endY = to.y;
    const middleY = (startY + endY) / 2;
    return {
      d: `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2 + 6,
      labelY: middleY - 7,
    };
  }

  const startX = from.x + CARD_WIDTH;
  const startY = from.y + CARD_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + CARD_HEIGHT / 2;
  const middleX = (startX + endX) / 2;
  return {
    d: `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`,
    labelX: middleX,
    labelY: (startY + endY) / 2 - 9,
  };
}

export default function AutomationFlowMap({
  flow,
  layout,
  layoutState,
  layoutMessage,
  isExisting,
  canPersist,
  onLayoutChange,
  onSaveLayout,
  onToggleNode,
  onEditNode,
}: AutomationFlowMapProps) {
  const [selectedId, setSelectedId] =
    useState<AutomationFlowNodeId>("trigger");
  const [drag, setDrag] = useState<{
    id: AutomationFlowNodeId;
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const nodeById = useMemo(
    () => new Map(flow.nodes.map((node) => [node.id, node])),
    [flow.nodes]
  );
  const positionById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes]
  );
  const selected = nodeById.get(selectedId) ?? flow.nodes[0];
  const selectedPosition = selected ? positionById.get(selected.id) : undefined;

  function changeNodePosition(id: AutomationFlowNodeId, x: number, y: number) {
    const next = clampPosition({ id, x, y });
    onLayoutChange({
      ...layout,
      nodes: layout.nodes.map((node) => (node.id === id ? next : node)),
    });
  }

  function nudgeSelected(deltaX: number, deltaY: number) {
    if (!selected || !selectedPosition) return;
    changeNodePosition(
      selected.id,
      selectedPosition.x + deltaX,
      selectedPosition.y + deltaY
    );
  }

  const canSave =
    canPersist && (layoutState === "dirty" || layoutState === "error");

  if (!selected) return null;

  return (
    <section
      aria-label="Mapa visual da automação"
      className="overflow-hidden rounded-[24px] border border-[#cfc5b5] bg-[#ece4d8] shadow-[0_18px_60px_rgba(17,38,32,0.08)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d0c6b7] bg-[#112620] px-5 py-4 text-white sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f5c451]">
            Arquitetura da conversa · V1
          </p>
          <h2 className="mt-1 font-display text-xl">Do primeiro sinal à próxima ação.</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#b8c7c1]">
          <span>
            <strong className="text-white">{flow.configuredSteps}</strong> de {flow.activeSteps} etapas prontas
          </span>
          <span className="hidden h-4 w-px bg-white/15 sm:block" />
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${flow.warnings.length ? "bg-[#f5c451]" : "bg-[#6ed1a9]"}`} />
            {flow.warnings.length ? `${flow.warnings.length} pendência${flow.warnings.length > 1 ? "s" : ""}` : "Fluxo consistente"}
          </span>
          {canPersist ? (
            <button
              type="button"
              onClick={onSaveLayout}
              disabled={!canSave}
              className="ml-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-bold text-white transition hover:bg-white/15 disabled:cursor-default disabled:opacity-45"
            >
              {layoutState === "saving" ? "Salvando…" : "Salvar organização"}
            </button>
          ) : (
            <span className="rounded-lg border border-white/10 px-3 py-2 text-[#9eb2aa]">
              {isExisting
                ? "Somente admins organizam"
                : "Organização disponível após criar"}
            </span>
          )}
        </div>
      </div>

      <div className="grid min-h-[580px] lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="brand-grid overflow-x-auto border-b border-[#d0c6b7] bg-[#f7f2e9] lg:border-b-0 lg:border-r">
          <div
            className="relative"
            style={{ width: FLOW_CANVAS_WIDTH, height: FLOW_CANVAS_HEIGHT }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox={`0 0 ${FLOW_CANVAS_WIDTH} ${FLOW_CANVAS_HEIGHT}`}
            >
              <defs>
                <marker
                  id="flow-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#8f8577" />
                </marker>
              </defs>
              {layout.edges.map((edge) => {
                const from = positionById.get(edge.from);
                const to = positionById.get(edge.to);
                if (!from || !to) return null;
                const path = connectionPath(from, to, edge.branch === "side");
                return (
                  <g key={`${edge.from}:${edge.to}`}>
                    <path
                      d={path.d}
                      fill="none"
                      stroke={edge.branch === "side" ? "#b87913" : "#8f8577"}
                      strokeDasharray={edge.branch === "side" ? "5 5" : undefined}
                      strokeWidth="1.4"
                      markerEnd="url(#flow-arrow)"
                    />
                    <text
                      x={path.labelX}
                      y={path.labelY}
                      textAnchor="middle"
                      className="fill-[#766d61] text-[9px] font-bold uppercase tracking-[0.12em]"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {flow.nodes.map((node) => {
              const position = positionById.get(node.id);
              if (!position) return null;
              return (
                <div
                  key={node.id}
                  className="absolute touch-none"
                  style={{ left: position.x, top: position.y }}
                >
                  <button
                    type="button"
                    aria-label={`Mover etapa ${node.title}`}
                    title="Arraste para organizar"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setSelectedId(node.id);
                      setDrag({
                        id: node.id,
                        pointerX: event.clientX,
                        pointerY: event.clientY,
                        originX: position.x,
                        originY: position.y,
                      });
                    }}
                    onPointerMove={(event) => {
                      if (!drag || drag.id !== node.id) return;
                      changeNodePosition(
                        node.id,
                        drag.originX + event.clientX - drag.pointerX,
                        drag.originY + event.clientY - drag.pointerY
                      );
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      setDrag(null);
                    }}
                    className="absolute -top-3 left-1/2 z-10 flex h-6 -translate-x-1/2 cursor-grab items-center gap-0.5 rounded-full border border-[#cec3b3] bg-[#fffdf8] px-2 text-[#887d70] shadow-sm active:cursor-grabbing"
                  >
                    <span aria-hidden="true">•••</span>
                  </button>
                  <FlowNodeCard
                    node={node}
                    selected={selected.id === node.id}
                    onSelect={() => setSelectedId(node.id)}
                  />
                </div>
              );
            })}
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

          <div className="mt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Posição no mapa
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Mover etapa selecionada">
              <span />
              <button type="button" onClick={() => nudgeSelected(0, -POSITION_STEP)} className="rounded-lg border border-border bg-white py-1.5 text-sm hover:bg-surface" aria-label="Mover etapa para cima">↑</button>
              <span />
              <button type="button" onClick={() => nudgeSelected(-POSITION_STEP, 0)} className="rounded-lg border border-border bg-white py-1.5 text-sm hover:bg-surface" aria-label="Mover etapa para a esquerda">←</button>
              <span className="grid place-items-center text-[9px] font-bold text-muted">20 px</span>
              <button type="button" onClick={() => nudgeSelected(POSITION_STEP, 0)} className="rounded-lg border border-border bg-white py-1.5 text-sm hover:bg-surface" aria-label="Mover etapa para a direita">→</button>
              <span />
              <button type="button" onClick={() => nudgeSelected(0, POSITION_STEP)} className="rounded-lg border border-border bg-white py-1.5 text-sm hover:bg-surface" aria-label="Mover etapa para baixo">↓</button>
              <span />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted">
              Arraste pelo puxador do cartão ou use os controles acima.
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

          {(layoutMessage || layoutState === "loading") && (
            <div
              className={`mt-5 rounded-xl border px-3 py-2.5 text-[11px] leading-5 ${
                layoutState === "error" || layoutState === "conflict"
                  ? "border-warning/25 bg-warning/5 text-warning"
                  : "border-border bg-surface/60 text-muted"
              }`}
            >
              {layoutState === "loading" ? "Carregando organização compartilhada…" : layoutMessage}
            </div>
          )}

          <div className="mt-7 border-t border-border pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              Contrato de execução
            </p>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              O mapa V1 guarda apenas posições e arestas canônicas. Mensagens e execução continuam no motor validado do worker.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
