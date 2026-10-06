import type { ChatMessage, LLMSettings } from '../types';

export type { ChatMessage };

export class LLMError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export function apiUrl(baseUrl: string, path: string): string {
  return `${trimSlash(baseUrl.trim())}${path}`;
}

async function raise(res: Response): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    // body unavailable
  }
  const hints: Record<number, string> = {
    401: ' — check the API key in Settings.',
    403: ' — the key may not have access to this model.',
    404: ' — check the base URL and model name.',
    429: ' — rate limited or out of quota.',
  };
  throw new LLMError(`Provider returned ${res.status}${hints[res.status] ?? ''}${detail ? ` · ${detail}` : ''}`, res.status);
}

/** Stream an OpenAI-compatible chat completion, yielding text deltas. */
export async function* streamChat(
  settings: LLMSettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  let res: Response;
  try {
    res = await fetch(apiUrl(settings.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: settings.temperature,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new LLMError(
      'Network error reaching the provider. If it persists, the endpoint may not allow browser (CORS) requests — try a provider that does, or run one locally (LM Studio / Ollama).',
    );
  }
  if (!res.ok) await raise(res);
  if (!res.body) throw new LLMError('Provider returned an empty response body.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Partial or non-JSON SSE line — skip it.
      }
    }
  }
}

/** Quick settings check: list models from the endpoint. */
export async function testConnection(settings: LLMSettings): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl(settings.baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
  } catch {
    throw new LLMError(
      'Network error. If it persists, the endpoint may not allow browser (CORS) requests.',
    );
  }
  if (!res.ok) await raise(res);
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean);
  return ids.length ? `Connected — ${ids.length} models available` : 'Connected';
}
