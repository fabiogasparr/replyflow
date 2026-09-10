import { z } from "zod";

export const FLOW_SCHEMA_VERSION = 1 as const;
export const FLOW_CANVAS_WIDTH = 1320;
export const FLOW_CANVAS_HEIGHT = 580;

export const FLOW_NODE_IDS = [
  "trigger",
  "public-reply",
  "opening-dm",
  "follow-gate",
  "delivery",
  "follow-up",
] as const;

export type FlowNodeId = (typeof FLOW_NODE_IDS)[number];

export interface FlowLayoutNode {
  id: FlowNodeId;
  x: number;
  y: number;
}

export interface FlowLayoutEdge {
  from: FlowNodeId;
  to: FlowNodeId;
  label: string;
  branch: "main" | "side";
}

export interface FlowDefinitionV1 {
  schemaVersion: typeof FLOW_SCHEMA_VERSION;
  nodes: FlowLayoutNode[];
  edges: FlowLayoutEdge[];
}

export const FLOW_CANONICAL_EDGES: FlowLayoutEdge[] = [
  { from: "trigger", to: "public-reply", label: "no comentário", branch: "side" },
  { from: "trigger", to: "opening-dm", label: "seguir fluxo", branch: "main" },
  { from: "opening-dm", to: "follow-gate", label: "continuar", branch: "main" },
  { from: "follow-gate", to: "delivery", label: "se sim", branch: "main" },
  { from: "delivery", to: "follow-up", label: "depois", branch: "main" },
];

const DEFAULT_POSITIONS: Record<FlowNodeId, { x: number; y: number }> = {
  trigger: { x: 36, y: 96 },
  "public-reply": { x: 36, y: 350 },
  "opening-dm": { x: 288, y: 96 },
  "follow-gate": { x: 540, y: 96 },
  delivery: { x: 792, y: 96 },
  "follow-up": { x: 1044, y: 96 },
};

const flowNodeSchema = z
  .object({
    id: z.enum(FLOW_NODE_IDS),
    x: z.number().int().min(0).max(FLOW_CANVAS_WIDTH - 196),
    y: z.number().int().min(0).max(FLOW_CANVAS_HEIGHT - 180),
  })
  .strict();

const flowEdgeSchema = z
  .object({
    from: z.enum(FLOW_NODE_IDS),
    to: z.enum(FLOW_NODE_IDS),
    label: z.string().min(1).max(40),
    branch: z.enum(["main", "side"]),
  })
  .strict();

const definitionSchema = z
  .object({
    schemaVersion: z.literal(FLOW_SCHEMA_VERSION),
    nodes: z.array(flowNodeSchema).length(FLOW_NODE_IDS.length),
    edges: z.array(flowEdgeSchema).length(FLOW_CANONICAL_EDGES.length),
  })
  .strict();

const flowNodesSchema = z
  .array(flowNodeSchema)
  .length(FLOW_NODE_IDS.length)
  .superRefine((nodes, context) => {
    const received = new Set(nodes.map((node) => node.id));
    if (
      received.size !== FLOW_NODE_IDS.length ||
      FLOW_NODE_IDS.some((id) => !received.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "O layout precisa conter cada etapa canônica uma única vez",
      });
    }
  });

export const flowLayoutUpdateSchema = z
  .object({
    revision: z.number().int().min(0),
    nodes: flowNodesSchema,
  })
  .strict();

function edgeKey(edge: FlowLayoutEdge) {
  return `${edge.from}:${edge.to}:${edge.label}:${edge.branch}`;
}

function hasCanonicalGraph(definition: FlowDefinitionV1) {
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  if (
    nodeIds.size !== FLOW_NODE_IDS.length ||
    FLOW_NODE_IDS.some((id) => !nodeIds.has(id))
  ) {
    return false;
  }

  const expectedEdges = new Set(FLOW_CANONICAL_EDGES.map(edgeKey));
  const receivedEdges = new Set(definition.edges.map(edgeKey));
  return (
    receivedEdges.size === expectedEdges.size &&
    FLOW_CANONICAL_EDGES.every((edge) => receivedEdges.has(edgeKey(edge)))
  );
}

export function createDefaultFlowDefinition(): FlowDefinitionV1 {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: FLOW_NODE_IDS.map((id) => ({ id, ...DEFAULT_POSITIONS[id] })),
    edges: FLOW_CANONICAL_EDGES.map((edge) => ({ ...edge })),
  };
}

export function createFlowDefinition(
  nodes: FlowLayoutNode[]
): FlowDefinitionV1 {
  const parsed = flowNodesSchema.parse(nodes);
  const byId = new Map(parsed.map((node) => [node.id, node]));
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: FLOW_NODE_IDS.map((id) => ({ ...byId.get(id)! })),
    edges: FLOW_CANONICAL_EDGES.map((edge) => ({ ...edge })),
  };
}

export function readFlowDefinition(value: unknown): {
  definition: FlowDefinitionV1;
  source: "stored" | "default" | "recovered";
} {
  if (value === null || value === undefined) {
    return { definition: createDefaultFlowDefinition(), source: "default" };
  }

  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success || !hasCanonicalGraph(parsed.data)) {
    return { definition: createDefaultFlowDefinition(), source: "recovered" };
  }

  return { definition: parsed.data, source: "stored" };
}
