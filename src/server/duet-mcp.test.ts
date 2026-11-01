import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let buildDuetServer: typeof import('./duet-mcp.js')['buildDuetServer'];
let db: typeof import('./store.js')['db'];

beforeAll(async () => {
  process.env.OPENDUET_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'openduet-duetmcp-'));
  await (await import('./store.js')).openStore();
  db = (await import('./store.js')).db;
  buildDuetServer = (await import('./duet-mcp.js')).buildDuetServer;
});

describe('duet_search_chats', () => {
  it('finds words across channels and skips non-matches', async () => {
    db.data.channels = [{ id: 'c1', name: 'launch', session: null, createdAt: 1 }];
    db.data.messages = [
      { id: '1', ts: 1_000, role: 'user', kind: 'chat', text: 'Plan the product launch deck' },
      { id: '2', ts: 2_000, role: 'duet', kind: 'chat', text: 'Saved launch-outline.md in the workspace.', channel: 'c1' },
      { id: '3', ts: 3_000, role: 'user', kind: 'chat', text: 'Unrelated groceries list' },
    ];
    const server = buildDuetServer();
    const tool = (server as any)._registeredTools?.search_chats ?? (server as any).tools?.search_chats;
    // SDK stores tools internally; call via the public request path instead.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(a);
    const hit = await client.callTool({ name: 'search_chats', arguments: { query: 'launch deck' } });
    const text = (hit.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
    expect(text).toMatch(/product launch deck/);
    expect(text).not.toMatch(/groceries/);
    const miss = await client.callTool({ name: 'search_chats', arguments: { query: 'zzzz-no-such' } });
    expect(JSON.stringify(miss.content)).toMatch(/No matching messages/);
    await client.close();
  });
});
