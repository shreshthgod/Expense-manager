import { z } from "zod";

/**
 * OpenAI-compatible chat-completions client. Works with any provider exposing
 * /chat/completions (OpenAI, Groq, OpenRouter, Together, Ollama, LM Studio...).
 * The application is fully functional when no provider is configured.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

const structuredOutputSchema = z.object({
  summary: z.string().min(1),
});

function getBaseUrl(): string | null {
  const url = process.env.AI_BASE_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
}

function getApiKey(): string | null {
  const key = process.env.AI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function isAIAvailable(): boolean {
  return getApiKey() != null && getBaseUrl() != null;
}

export function aiModelName(): string {
  return process.env.AI_MODEL?.trim() || "gpt-4o-mini";
}

async function callChatCompletions(options: GenerateOptions): Promise<string> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  if (!apiKey || !baseUrl) throw new Error("AI provider not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiModelName(),
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 700,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI provider error ${response.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Requests structured JSON output matching the given schema. Retries once
 * with a correction instruction; falls back to `null` when still invalid so
 * callers can use their deterministic path.
 */
export async function generateStructuredOutput<T>(
  options: GenerateOptions,
  schema: z.ZodType<T>,
  fallback: T
): Promise<{ value: T; usedAI: boolean }> {
  if (!isAIAvailable()) return { value: fallback, usedAI: false };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callChatCompletions({
        ...options,
        messages:
          attempt === 0
            ? options.messages
            : [
                ...options.messages,
                {
                  role: "system" as const,
                  content:
                    "Your previous response was not valid according to the required format. Respond again with ONLY valid JSON matching the instructions exactly.",
                },
              ],
      });
      const cleaned = stripCodeFences(raw);
      const parsed = schema.safeParse(safeJsonParse(cleaned));
      if (parsed.success) return { value: parsed.data, usedAI: true };
    } catch (error) {
      console.error("[ai-provider] generation failed:", error);
      break;
    }
  }
  return { value: fallback, usedAI: false };
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export async function generateText(options: GenerateOptions): Promise<string | null> {
  if (!isAIAvailable()) return null;
  try {
    return await callChatCompletions(options);
  } catch (error) {
    console.error("[ai-provider] text generation failed:", error);
    return null;
  }
}
