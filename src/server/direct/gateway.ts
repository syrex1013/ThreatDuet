import { db } from '../store.js';
/** Kilo's hosted gateway: an OpenAI-compatible chat API. Free models need no account. */
const GATEWAY = process.env.KILO_GATEWAY_URL ?? 'https://api.kilo.ai/api/gateway';
/** NVIDIA NIM, for models named nim/<catalog id>: the same API shape, credentials from NVIDIA_API_KEY or NIM_API_KEY. */
const NIM = 'https://integrate.api.nvidia.com/v1';
const nimKey = () => process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY || '';
export const isNim = (model: string) => model.startsWith('nim/');

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Reply {
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning_details?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** "kilo/kilo-auto/free" is how the app names it; the gateway wants "kilo-auto/free". NIM: "nim/" dropped. */
export const gatewayModel = (model: string) => model.replace(/^(kilo|nim)\//, '');

/** Assemble OpenAI-compatible deltas before exposing any tool call for execution. */
export async function readChatStream(response: Response, onText?: (text: string) => void): Promise<Reply> {
  if (!response.body) throw new Error('Provider returned no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let done = false;
  let usage: Reply['usage'];
  const calls = new Map<number, ToolCall>();
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { done = true; break; }
        const value = JSON.parse(data);
        if (value.error) throw new Error('Provider stream failed.');
        if (value.usage) usage = value.usage;
        const delta = value.choices?.[0]?.delta;
        if (typeof delta?.content === 'string') { content += delta.content; onText?.(content); }
        for (const part of delta?.tool_calls ?? []) {
          const index = part.index ?? 0;
          const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (part.id) call.id = part.id;
          call.function.name += part.function?.name ?? '';
          call.function.arguments += part.function?.arguments ?? '';
          calls.set(index, call);
        }
      }
    }
    if (!done) throw new Error('Provider stream ended before completion.');
    return { content: content || null, tool_calls: calls.size ? [...calls.values()] : undefined, usage };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function chat(model: string, messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal, maxTokens?: number, onText?: (text: string) => void): Promise<Reply> {
  const custom = db?.data?.provider?.baseUrl;
  const nim = !custom && isNim(model);
  const key = custom ? process.env[db.data.provider.keyEnv] : nim ? nimKey() : process.env.KILO_API_KEY;
  if (nim && !key) throw new Error('NVIDIA NIM requires NVIDIA_API_KEY or NIM_API_KEY.');
  const where = custom ? 'the configured provider' : nim ? 'NVIDIA NIM' : 'the Kilo gateway';
  let last = '';
  const r = await fetch(`${(custom || (nim ? NIM : GATEWAY)).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: custom ? model : gatewayModel(model), messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), stream: true, stream_options: { include_usage: true }, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  }).catch((e: Error) => {
    if (signal.aborted) throw e;
    last = `Can't reach ${where}: ${e.message}`;
    return null;
  });
  if (r?.ok) {
    if (r.headers.get('content-type')?.includes('text/event-stream')) return readChatStream(r, onText);
    const body = (await r.json().catch((e: Error) => {
      if (signal.aborted) throw e;
      return null;
    })) as { choices?: { message?: Reply }[]; error?: { message?: string }; usage?: Reply['usage'] } | null;
    const m = body?.choices?.[0]?.message;
    if (m) return { content: m.content ?? null, tool_calls: m.tool_calls?.length ? m.tool_calls : undefined, reasoning_details: m.reasoning_details, usage: body?.usage };
    last = body?.error?.message ?? `${where} sent an ${body ? 'empty' : 'unreadable'} answer.`;
  } else if (r) {
    const text = (await r.text().catch(() => '')).slice(0, 300);
    if (r.status === 429) last = `${where} is rate-limited. Try again later.`;
    else if (r.status >= 400 && r.status < 500) throw new Error(`${where} refused the request (${r.status}): ${text}`);
    else last = `${where} answered ${r.status}.`;
  }
  throw new Error(last || `${where} did not answer.`);
}
