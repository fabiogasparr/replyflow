/**
 * AI assistance for campaigns: sentiment triage, personalised wording and
 * variation generation. All prompts are in pt-BR because that is the product
 * language; the model is told to answer in the language of the comment.
 *
 * Guardrails that matter for the account's safety are enforced in code, not
 * left to the prompt: placeholders are preserved, a DM that must carry a link
 * always ends up with {link}, lengths are capped, and every function degrades
 * to `null` so the worker falls back to the campaign's own templates.
 */

import {
  chatCompletion,
  isAiConfigured,
  looksLikeReasoning,
  parseJsonObject,
} from "./client";
import { hasSpintax, listSpintaxExpansions } from "@/lib/messaging/variation";

export type ModerationSensitivity = "HOSTILE" | "NEGATIVE";
export const MODERATION_SENSITIVITIES: ModerationSensitivity[] = ["HOSTILE", "NEGATIVE"];

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface CommentAssessment {
  sentiment: Sentiment;
  /** Insulting, derogatory, threatening or spam-like. */
  hostile: boolean;
  /** Asks something a template cannot answer (complaint, refund, urgent issue). */
  needsHuman: boolean;
  reason: string;
}

export interface AiContext {
  brandUsername: string;
  campaignName: string;
  campaignGoal?: string | null;
  instructions?: string | null;
  keywords?: string[];
}

const PUBLIC_REPLY_MAX_CHARS = 280;
const DM_MAX_CHARS = 600;
const VARIATION_MAX_CHARS = 1000;

function trimTo(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

function baseSystemPrompt(context: AiContext): string {
  const lines = [
    `Você escreve respostas curtas para o perfil do Instagram @${context.brandUsername}, dentro de uma automação de comentários da campanha "${context.campaignName}".`,
    context.campaignGoal ? `Objetivo da campanha: ${context.campaignGoal}.` : null,
    context.keywords?.length
      ? `Palavras-chave que acionam a campanha: ${context.keywords.join(", ")}.`
      : null,
    context.instructions?.trim()
      ? `Instruções da marca (siga à risca): ${context.instructions.trim()}`
      : null,
    "Regras fixas: responda no idioma do comentário (padrão português do Brasil); tom humano e natural, sem parecer robô; nunca invente preços, prazos, promoções ou dados que não estejam nas instruções; nunca ofenda, discuta ou responda provocações; não use hashtags; no máximo um emoji; não diga que é uma inteligência artificial; não peça dados pessoais.",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Classify a comment/DM. Returns null when AI is unavailable or the answer
 * cannot be parsed — callers must treat that as "no opinion".
 */
export async function assessComment(
  text: string,
  context: AiContext
): Promise<CommentAssessment | null> {
  if (!isAiConfigured() || !text.trim()) return null;
  try {
    const { text: raw } = await chatCompletion({
      json: true,
      temperature: 0,
      maxTokens: 200,
      messages: [
        {
          role: "system",
          content:
            `Você tria comentários recebidos pelo perfil @${context.brandUsername} no Instagram. ` +
            "Responda SOMENTE um objeto JSON com os campos: " +
            `"sentiment" ("POSITIVE" | "NEUTRAL" | "NEGATIVE"), ` +
            `"hostile" (true SOMENTE quando o texto é ofensivo, depreciativo, ameaçador, discriminatório ou spam), ` +
            `"needsHuman" (true SOMENTE para reclamação de cliente, pedido de reembolso/cancelamento, problema urgente, ameaça legal ou ironia agressiva — situações em que enviar um material automático seria inadequado), ` +
            `"reason" (frase curta em português explicando). ` +
            "A automação responde comentários enviando um material/link no direct. Portanto: pedidos de link, elogios, curiosidade, perguntas comuns sobre o produto (se funciona para X, como funciona, serve para mim?) e comentários com a palavra-chave são POSITIVE ou NEUTRAL, hostile=false e needsHuman=false — uma dúvida não é motivo para reservar a um humano. " +
            "Responda apenas o JSON, sem raciocínio.",
        },
        { role: "user", content: `Comentário: """${text.slice(0, 1000)}"""` },
      ],
    });
    const parsed = parseJsonObject<Partial<CommentAssessment>>(raw);
    if (!parsed) return null;
    const sentiment = String(parsed.sentiment ?? "NEUTRAL").toUpperCase();
    return {
      sentiment: (["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(sentiment)
        ? sentiment
        : "NEUTRAL") as Sentiment,
      hostile: parsed.hostile === true,
      needsHuman: parsed.needsHuman === true,
      reason: typeof parsed.reason === "string" ? trimTo(parsed.reason, 300) : "",
    };
  } catch (error) {
    console.warn("[AI] Comment assessment failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Should this comment be held for a person instead of auto-replied? */
export function shouldHoldForHuman(
  assessment: CommentAssessment | null,
  sensitivity: ModerationSensitivity | string
): boolean {
  if (!assessment) return false;
  if (assessment.hostile || assessment.needsHuman) return true;
  return sensitivity === "NEGATIVE" && assessment.sentiment === "NEGATIVE";
}

export function humanReviewMessage(assessment: CommentAssessment): string {
  const label = assessment.hostile
    ? "comentário ofensivo ou depreciativo"
    : assessment.needsHuman
      ? "comentário que precisa de atenção humana"
      : "comentário negativo";
  return `Reservado para revisão humana (${label}). ${assessment.reason}`.trim();
}

/**
 * Write the public reply for one specific comment. Falls back to null so the
 * template pool is used. The reply never contains a link (public replies with
 * links look like spam) and stays short.
 */
export async function generatePersonalizedPublicReply(params: {
  commentText: string;
  commenterName?: string | null;
  templateExample?: string | null;
  context: AiContext;
}): Promise<string | null> {
  if (!isAiConfigured()) return null;
  try {
    const { text } = await chatCompletion({
      temperature: 0.8,
      maxTokens: 400,
      messages: [
        { role: "system", content: baseSystemPrompt(params.context) },
        {
          role: "user",
          content: [
            "Escreva UMA resposta pública para o comentário abaixo, como se fosse a própria marca respondendo no post. Responda direto com o texto final, sem raciocinar em voz alta.",
            "A pessoa vai receber o material/link no direct, então a resposta deve dizer isso de forma natural e personalizada ao que ela escreveu.",
            params.templateExample
              ? `Exemplo do estilo que a marca usa: "${params.templateExample}"`
              : null,
            `Nome de quem comentou: ${params.commenterName || "(desconhecido)"}.`,
            `Comentário: """${params.commentText.slice(0, 1000)}"""`,
            `Responda apenas com o texto da resposta, sem aspas, sem links, com no máximo ${PUBLIC_REPLY_MAX_CHARS} caracteres.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    if (looksLikeReasoning(text)) return null;
    const reply = trimTo(stripQuotes(text), PUBLIC_REPLY_MAX_CHARS);
    if (!reply || /https?:\/\//i.test(reply)) return null;
    return reply;
  } catch (error) {
    console.warn("[AI] Public reply generation failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Write the DM for one specific comment. When the campaign delivers a link the
 * result is guaranteed to contain the {link} placeholder so tracking keeps
 * working whichever delivery mode (button or inline) is used.
 */
export async function generatePersonalizedDm(params: {
  commentText: string;
  commenterName?: string | null;
  template: string;
  hasLink: boolean;
  context: AiContext;
}): Promise<string | null> {
  if (!isAiConfigured()) return null;
  try {
    const { text } = await chatCompletion({
      temperature: 0.8,
      maxTokens: 500,
      messages: [
        { role: "system", content: baseSystemPrompt(params.context) },
        {
          role: "user",
          content: [
            "Escreva a mensagem direta (DM) que a marca envia para quem fez o comentário abaixo. Responda direto com o texto final, sem raciocinar em voz alta.",
            `Use este modelo como base de conteúdo e intenção: """${params.template}"""`,
            "Personalize de verdade: mencione ou responda brevemente ao que a pessoa escreveu no comentário (uma frase), mantendo o mesmo objetivo do modelo. Não copie o modelo sem mudanças.",
            "Mantenha os marcadores {username} (nome da pessoa) e, se existir no modelo, {link} exatamente assim, sem substituí-los.",
            params.hasLink
              ? "A DM DEVE conter o marcador {link} uma vez, onde o link entra."
              : "Não inclua links.",
            `Nome de quem comentou: ${params.commenterName || "(desconhecido)"}.`,
            `Comentário: """${params.commentText.slice(0, 1000)}"""`,
            `Responda apenas com o texto da DM, sem aspas, com no máximo ${DM_MAX_CHARS} caracteres.`,
          ].join("\n"),
        },
      ],
    });
    if (looksLikeReasoning(text)) return null;
    let dm = trimTo(stripQuotes(text), DM_MAX_CHARS);
    if (!dm) return null;
    if (params.hasLink && !/\{link\}/i.test(dm)) dm = `${dm} {link}`;
    if (!params.hasLink) dm = dm.replace(/\s*\{link\}\s*/gi, " ").trim();
    return dm;
  } catch (error) {
    console.warn("[AI] DM generation failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Produce `count` alternative wordings of a message for the variations lists.
 * Placeholders are preserved; results are deduplicated against the base.
 */
export async function generateVariations(params: {
  base: string;
  count: number;
  kind: "publicReply" | "dm" | "openingDm" | "followPrompt" | "followUp";
  context: AiContext;
}): Promise<string[]> {
  const count = Math.max(1, Math.min(10, Math.floor(params.count)));
  const kindLabel: Record<typeof params.kind, string> = {
    publicReply: "resposta pública a um comentário no post",
    dm: "mensagem direta (DM) que entrega o link",
    openingDm: "primeira DM, que convida a tocar em um botão",
    followPrompt: "pedido para seguir o perfil antes de receber o link",
    followUp: "mensagem de agradecimento enviada depois",
  };
  const { text } = await chatCompletion({
    json: true,
    temperature: 0.9,
    maxTokens: 900,
    messages: [
      { role: "system", content: baseSystemPrompt(params.context) },
      {
        role: "user",
        content: [
          `Crie ${count} variações diferentes desta ${kindLabel[params.kind]}, com o mesmo sentido, mas frases, ritmo e cumprimentos distintos, para que os envios não pareçam idênticos.`,
          "Preserve exatamente os marcadores {username} e {link} quando existirem no original.",
          `Original: """${params.base}"""`,
          `Responda SOMENTE um objeto JSON no formato {"variations": ["...", "..."]} com ${count} textos de até ${VARIATION_MAX_CHARS} caracteres cada, sem aspas extras.`,
        ].join("\n"),
      },
    ],
  });
  const parsed = parseJsonObject<{ variations?: unknown }>(text);
  const list = Array.isArray(parsed?.variations) ? parsed.variations : [];
  const mustKeepLink = /\{link\}/i.test(params.base);
  const seen = new Set([params.base.trim()]);
  const results: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    let candidate = trimTo(stripQuotes(item), VARIATION_MAX_CHARS);
    if (!candidate || seen.has(candidate)) continue;
    if (mustKeepLink && !/\{link\}/i.test(candidate)) candidate = `${candidate} {link}`;
    seen.add(candidate);
    results.push(candidate);
    if (results.length >= count) break;
  }
  return results;
}

/** Preview helper for the builder: every rendering a spintax message yields. */
export function previewVariations(text: string): string[] {
  return hasSpintax(text) ? listSpintaxExpansions(text, 20) : [text];
}

function stripQuotes(text: string): string {
  return text.trim().replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
}
