import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.THREATDUET_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-gateway-'));
const store = await import('./store.js');
const { chat, readChatStream } = await import('./direct/gateway.js');
beforeAll(() => store.openStore());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); store.db.data.provider.baseUrl = ''; });

describe('streamed providers', () => {
  it('preserves ordered reasoning metadata privately across streaming chunks', async () => {
    const details = [{ type: 'reasoning.text', index: 0, text: 'private reasoning', signature: 'signed' }, { type: 'reasoning.encrypted', index: 1, data: 'encrypted-block' }];
    const stream = details.map((detail) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_details: [detail] } }] })}\n\n`).join('') + 'data: {"choices":[{"delta":{"content":"Visible summary"}}]}\n\ndata: [DONE]\n\n';
    const visible = vi.fn();
    const reply = await readChatStream(new Response(stream), visible);
    expect(reply.reasoning_details).toEqual(details);
    expect(visible).toHaveBeenCalledExactlyOnceWith('Visible summary');
    expect(reply.content).not.toContain('private reasoning');
  });
  it('assembles fragmented tool arguments, text and provider-reported usage', async () => {
    const packets = [
      { choices: [{ delta: { content: 'Hello ', tool_calls: [{ index: 0, id: 'c1', function: { name: 'mail_send', arguments: '{"to":' } }] } }] },
      { choices: [{ delta: { content: 'Bob.', tool_calls: [{ index: 0, function: { arguments: '"bob@example.com"}' } }] } }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } },
    ];
    const bytes = new TextEncoder().encode(packets.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n');
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    const progress = vi.fn();
    const reply = await readChatStream(new Response(stream), progress);
    expect(reply.content).toBe('Hello Bob.');
    expect(reply.tool_calls?.[0]).toMatchObject({ id: 'c1', function: { name: 'mail_send', arguments: '{"to":"bob@example.com"}' } });
    expect(reply.usage).toEqual({ prompt_tokens: 12, completion_tokens: 8 });
    expect(progress).toHaveBeenLastCalledWith('Hello Bob.');
  });

  it('rejects truncated streams rather than dispatching partial tool calls', async () => {
    await expect(readChatStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))).rejects.toThrow('before completion');
  });

  it('uses configured endpoint, environment key and exact custom model id', async () => {
    store.db.data.provider.baseUrl = 'http://127.0.0.1:11434/v1/';
    store.db.data.provider.keyEnv = 'DUET_TEST_KEY';
    vi.stubEnv('DUET_TEST_KEY', 'test-key');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Ready' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const reply = await chat('local/model', [{ role: 'user', content: 'go' }], [], new AbortController().signal, 100);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const options = fetch.mock.calls[0][1];
    expect(options.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(options.body)).toMatchObject({ model: 'local/model', stream: true, max_tokens: 100 });
    expect(reply.usage?.completion_tokens).toBe(2);
  });

  it('requires NIM credentials without making a network request', async () => {
    vi.stubEnv('NVIDIA_API_KEY', ''); vi.stubEnv('NIM_API_KEY', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(chat('nim/model', [], [], new AbortController().signal)).rejects.toThrow('requires NVIDIA_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });
});
