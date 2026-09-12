/**
 * Minimal OpenAI-compatible chat client.
 *
 * ReplyFlow talks to an OpenAI-style `/chat/completions` endpoint so the
 * provider can be swapped by configuration alone — in production that is an
 * OmniRoute gateway, which fronts several providers behind one key. Two
 * models are configured: AI_MODEL is tried first and AI_FALLBACK_MODEL takes
 * over when the primary errors, times out or returns nothing, so a quota blip
 * on one provider never stalls the worker.
 *
 * Nothing here is load-bearing for delivery: every caller must treat `null`
 * as "no AI available" and fall back to the campaign's templates.
 */

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string | null;
  timeoutMs: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object (when it supports response_format). */
  json?: boolean;
}

export interface ChatResult {
  text: string;
  model: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  const timeout = Number(env.AI_TIMEOUT_MS);
  return {
    baseUrl,
    apiKey,
    model,
    fallbackModel: env.AI_FALLBACK_MODEL?.trim() || null,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function isAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAiConfig(env) !== null;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI provider is not configured") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

type FetchLike = typeof fetch;

async function callModel(
  config: AiConfig,
  model: string,
  options: ChatOptions,
  fetchImpl: FetchLike
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 400,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AI ${model} HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`AI ${model} returned an empty completion`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a chat completion with primary → fallback model. Throws
 * AiUnavailableError when nothing is configured; rethrows the last provider
 * error when both models fail.
 */
export async function chatCompletion(
  options: ChatOptions,
  deps: { config?: AiConfig | null; fetchImpl?: FetchLike } = {}
): Promise<ChatResult> {
  const config = deps.config === undefined ? getAiConfig() : deps.config;
  if (!config) throw new AiUnavailableError();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const models = [config.model, config.fallbackModel].filter(
    (m, i, all): m is string => Boolean(m) && all.indexOf(m) === i
  );
  let lastError: unknown = null;
  for (const model of models) {
    try {
      const text = await callModel(config, model, options, fetchImpl);
      return { text, model };
    } catch (error) {
      lastError = error;
      console.warn(`[AI] ${model} failed, ${models.indexOf(model) < models.length - 1 ? "trying fallback" : "no fallback left"}:`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI request failed");
}

/**
 * Pull a JSON object out of a completion. Tolerates code fences and prose
 * around the object, which smaller models still produce even when asked for
 * JSON.
 */
export function parseJsonObject<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
