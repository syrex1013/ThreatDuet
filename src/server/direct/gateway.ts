/** Kilo's hosted gateway: an OpenAI-compatible chat API. Free models need no account. */
const GATEWAY = process.env.KILO_GATEWAY_URL ?? 'https://api.kilo.ai/api/gateway';
/** NVIDIA NIM, for models named nim/<catalog id>: the same API shape, a built-in key (override with NVIDIA_API_KEY). */
const NIM = 'https://integrate.api.nvidia.com/v1';
const NIM_KEY = process.env.NVIDIA_API_KEY ?? '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';
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
}

/** "kilo/kilo-auto/free" is how the app names it; the gateway wants "kilo-auto/free". NIM: "nim/" dropped. */
export const gatewayModel = (model: string) => model.replace(/^(kilo|nim)\//, '');

export async function chat(model: string, messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal): Promise<Reply> {
  const nim = isNim(model);
  const key = nim ? NIM_KEY : process.env.KILO_API_KEY;
  const where = nim ? 'NVIDIA NIM' : 'the Kilo gateway';
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${nim ? NIM : GATEWAY}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: gatewayModel(model), messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), stream: false }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    }).catch((e: Error) => {
      if (signal.aborted) throw e;
      last = `Can't reach ${where}: ${e.message}`;
      return null;
    });
    if (r?.ok) {
      const body = (await r.json().catch((e: Error) => {
        if (signal.aborted) throw e;
        return null;
      })) as { choices?: { message?: Reply }[]; error?: { message?: string } } | null;
      const m = body?.choices?.[0]?.message;
      if (m) return { content: m.content ?? null, tool_calls: m.tool_calls?.length ? m.tool_calls : undefined, reasoning_details: m.reasoning_details };
      last = body?.error?.message ?? `${where} sent an ${body ? 'empty' : 'unreadable'} answer.`;
    } else if (r) {
      const text = (await r.text().catch(() => '')).slice(0, 300);
      if (r.status === 429) last = nim ? 'NVIDIA NIM is rate-limited right now (about 40 requests a minute). Try again later.' : 'The free Kilo models are rate-limited right now (anonymous use allows about 200 requests an hour). Try again later, or set KILO_API_KEY.';
      else if (r.status >= 400 && r.status < 500) throw new Error(`${where} refused the request (${r.status}): ${text}`);
      else last = `${where} answered ${r.status}.`;
    }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error(last || `${where} did not answer.`);
}
