import { beforeAll, beforeEach, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.THREATDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-approval-`);
});
vi.mock('./direct/gateway.js', () => ({ chat: vi.fn() }));
vi.mock('./direct/mcp-client.js', () => ({ openTools: vi.fn(), dropConnections: vi.fn() }));
const store = await import('./store.js');
const { runDirect } = await import('./direct/runtime.js');
const { chat } = await import('./direct/gateway.js');
const { openTools } = await import('./direct/mcp-client.js');
const model = vi.mocked(chat);
const send = vi.fn();
const action = { tool: 'mail_send', arguments: { to: 'bob@example.com', body: 'Hello' } };
const toolReply = (body = 'Hello') => ({ content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'mail_send', arguments: JSON.stringify({ to: 'bob@example.com', body }) } }] });

beforeAll(() => store.openStore());
beforeEach(() => {
  store.db.data.receipts = []; store.db.data.permissions = []; store.db.data.usage = [];
  store.db.data.provider.maxRequests = 40; store.db.data.provider.maxTokens = 0;
  model.mockReset(); send.mockReset().mockResolvedValue('Sent, id 123');
  vi.mocked(openTools).mockResolvedValue({ tools: [{ name: 'mail_send', description: '', schema: {}, call: send }], close: async () => {} });
});

it('previews exact arguments before any approved-agent external write', async () => {
  model.mockResolvedValueOnce(toolReply());
  const result = await runDirect({ prompt: 'Send Hello', model: 'test', agent: 'code', auto: true }, () => '');
  expect(result.pendingCalls).toEqual([action]);
  expect(send).not.toHaveBeenCalled();
  expect(store.db.data.receipts).toHaveLength(0);
});

it('requires renewed approval for changed arguments', async () => {
  model.mockResolvedValueOnce(toolReply('Changed'));
  const result = await runDirect({ prompt: 'Send Hello', model: 'test', agent: 'code', auto: true, approvedCalls: [action] }, () => '');
  expect(result.pendingCalls?.[0].arguments.body).toBe('Changed');
  expect(send).not.toHaveBeenCalled();
});

it('records successful actions and never dispatches the same proposal twice', async () => {
  model.mockResolvedValueOnce(toolReply()).mockResolvedValueOnce(toolReply()).mockResolvedValueOnce({ content: 'Done' });
  const result = await runDirect({ prompt: 'Send Hello', model: 'test', agent: 'code', auto: true, approvedCalls: [action], proposalId: 'p1' }, () => '');
  expect(result.errors).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.db.data.receipts).toHaveLength(1);
  expect(store.db.data.receipts[0].status).toBe('confirmed');
});

it('keeps saved permission scoped and stops when usage cannot enforce token budget', async () => {
  store.db.data.permissions.push({ ...action, id: 'rule', expiresAt: Date.now() + 1000 });
  store.db.data.provider.maxTokens = 100;
  model.mockResolvedValueOnce(toolReply());
  const result = await runDirect({ prompt: 'Send Hello', model: 'test', agent: 'duet' }, () => '');
  expect(result.errors[0]).toContain('token budget cannot be enforced');
  expect(send).not.toHaveBeenCalled();
  expect(store.db.data.usage[0].requests).toBe(1);
  expect(store.db.data.usage[0].promptTokens).toBeNull();
});
