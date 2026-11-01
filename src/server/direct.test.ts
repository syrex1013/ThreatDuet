import { describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.OPENDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/openduet-direct-`);
});

vi.mock('./direct/gateway.js', async (orig) => ({ ...(await orig<typeof import('./direct/gateway.js')>()), chat: vi.fn() }));

describe("built-in agent rules and gateway", () => {
  it('obeys the same permission file as Kilo', async () => {
    const store = await import('./store.js');
    await store.openStore();
    const settings = await import('./mac/settings.js');
    await settings.setMac({ files: true, shell: true });
    const { policyFor } = await import('./direct/permit.js');
    const duet = await policyFor('duet', false);
    for (const t of ['read', 'list', 'glob', 'grep', 'skill', 'mac_files_read', 'mac_browser_read']) expect(duet.tool(t), t).toBe('allow');
    for (const t of ['bash', 'mac_shell_run', 'mac_files_write', 'mac_browser_click', 'webfetch', 'made_up_tool']) expect(duet.tool(t), t).toBe('deny');
    expect(duet.tool('write')).toBe('allow');
    expect(duet.edit('notes.md')).toBe('allow');
    for (const f of ['kilo.json', 'AGENTS.md', '.kilo/skills/x/SKILL.md', 'sub/kilo.json']) expect(duet.edit(f), f).toBe('deny');
    const code = await policyFor('code', true);
    expect(code.tool('mac_shell_run')).toBe('allow');
    expect(code.tool('bash')).toBe('deny');
    expect(code.edit('kilo.json')).toBe('deny');
  });

  it('fails closed: no rules file, no tools', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { WORKSPACE } = await import('./config.js');
    const { policyFor } = await import('./direct/permit.js');
    const file = path.join(WORKSPACE, 'kilo.json');
    const saved = await fs.readFile(file, 'utf8');
    await fs.rm(file);
    expect((await policyFor('duet', false)).tool('read')).toBe('deny');
    expect((await policyFor('code', true)).tool('mac_shell_run')).toBe('deny');
    await fs.writeFile(file, '{ not json');
    expect((await policyFor('code', true)).edit('a.txt')).toBe('deny');
    await fs.writeFile(file, saved);
  });

  it('never fetches private addresses, including by redirect target', async () => {
    const { privateAddress } = await import('./direct/tools.js');
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '::', 'fd00::1', 'fe80::1', 'fec0::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', '100.64.0.1', '224.0.0.1', 'not-an-ip']) expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(privateAddress(ip), ip).toBe(false);
    // The connection's own lookup refuses a name that resolves to this computer (what a rebinding answer would be).
    const { safeLookup } = await import('./direct/tools.js');
    const err = await new Promise<Error | null>((res) => safeLookup('localhost', undefined, (e) => res(e)));
    expect(err?.message).toMatch(/inside this computer/);
  });

  it('names models the way the gateway expects', async () => {
    const { gatewayModel } = await import('./direct/gateway.js');
    expect(gatewayModel('kilo/kilo-auto/free')).toBe('kilo-auto/free');
    expect(gatewayModel('anthropic/claude')).toBe('anthropic/claude');
  });

  it('refuses malformed tool calls and names written files in their chips', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { WORKSPACE } = await import('./config.js');
    const { chat } = await import('./direct/gateway.js');
    const { runDirect } = await import('./direct/runtime.js');
    const call = (id: string, name: string, args: string) => ({ content: null, tool_calls: [{ id, type: 'function' as const, function: { name, arguments: args } }] });
    const mock = vi.mocked(chat);
    mock
      .mockResolvedValueOnce(call('1', 'write', '{"path":"a.md","cont'))
      .mockResolvedValueOnce(call('2', 'write', '{"path":"a.md"}'))
      .mockResolvedValueOnce(call('3', 'write', 'null'))
      .mockResolvedValueOnce(call('4', 'write', '{"path":"notes/x.md","content":"hi"}'))
      .mockResolvedValueOnce({ content: 'done' });
    const r = await runDirect({ prompt: 'go', model: 'kilo/kilo-auto/free', agent: 'duet' }, () => '');
    const replies = (mock.mock.calls.at(-1)![1] as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);
    expect(replies[0]).toMatch(/not valid JSON/);
    expect(replies[1]).toMatch(/Missing required argument\(s\): content/);
    expect(replies[2]).toMatch(/must be a JSON object/);
    expect(replies[3]).toMatch(/^Wrote 2 characters/);
    await expect(fs.stat(path.join(WORKSPACE, 'undefined'))).rejects.toThrow();
    await expect(fs.stat(path.join(WORKSPACE, 'a.md'))).rejects.toThrow();
    expect(await fs.readFile(path.join(WORKSPACE, 'notes/x.md'), 'utf8')).toBe('hi');
    expect(r.tools.map((t) => t.title)).toContain('notes/x.md');
  });

  it('keeps one long turn under the history cap', async () => {
    const { trim } = await import('./direct/runtime.js');
    const big = 'x'.repeat(100_000);
    const h: import('./direct/gateway.js').ChatMessage[] = [{ role: 'user', content: 'go' }];
    for (let i = 0; i < 5; i++) h.push({ role: 'assistant', content: null, tool_calls: [{ id: `${i}`, type: 'function', function: { name: 'read', arguments: '{}' } }] }, { role: 'tool', tool_call_id: `${i}`, content: big });
    trim(h);
    expect(h.length).toBe(11);
    expect(h.reduce((n, m) => n + JSON.stringify(m).length, 0)).toBeLessThanOrEqual(300_000);
    expect(h.at(-1)).toMatchObject({ tool_call_id: '4', content: big });
    expect(h[2]).toMatchObject({ tool_call_id: '0', content: '[older tool output removed]' });
  });

  it('handles CRLF files and folder globs', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { WORKSPACE } = await import('./config.js');
    const { builtinTools } = await import('./direct/tools.js');
    const tool = (n: string) => builtinTools().find((t) => t.name === n)!;
    await fs.mkdir(path.join(WORKSPACE, 'crlf'), { recursive: true });
    const file = path.join(WORKSPACE, 'crlf', 'win.txt');
    await fs.writeFile(file, 'one\r\ntwo foo\r\nthree\r\n');
    await tool('edit').call({ path: 'crlf/win.txt', oldString: 'one\ntwo foo', newString: 'uno\ndos foo' });
    expect(await fs.readFile(file, 'utf8')).toBe('uno\r\ndos foo\r\nthree\r\n');
    expect(await tool('grep').call({ pattern: 'foo$', include: 'crlf/*.txt' })).toContain('crlf/win.txt:2: dos foo');
    expect(await tool('read').call({ path: 'crlf/win.txt' })).not.toContain('\r');
    expect(await tool('glob').call({ pattern: 'crlf/*.txt' })).toBe('crlf/win.txt');
    expect(await tool('glob').call({ pattern: 'crlf\\*.txt' })).toBe('crlf/win.txt');
    expect(await tool('grep').call({ pattern: 'foo', include: 'crlf\\*.txt' })).toContain('crlf/win.txt');
    // Mixed endings: an LF region keeps LF, a CRLF region gets CRLF, and a CRLF newString is not doubled.
    await fs.writeFile(file, 'a\r\nb\r\nc\nd\n');
    await tool('edit').call({ path: 'crlf/win.txt', oldString: 'c\nd', newString: 'C\nD' });
    expect(await fs.readFile(file, 'utf8')).toBe('a\r\nb\r\nC\nD\n');
    await tool('edit').call({ path: 'crlf/win.txt', oldString: 'a', newString: 'x\r\ny' });
    expect(await fs.readFile(file, 'utf8')).toBe('x\r\ny\r\nb\r\nC\nD\n');
    await tool('edit').call({ path: 'crlf/win.txt', oldString: 'b', newString: 'p\nq' });
    expect(await fs.readFile(file, 'utf8')).toBe('x\r\ny\r\np\r\nq\r\nC\nD\n');
  });

  it('starts a local app once while its first connect is still running', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { DATA_DIR } = await import('./config.js');
    const { db } = await import('./store.js');
    const { connectorStatuses } = await import('./direct/mcp-client.js');
    const mark = path.join(DATA_DIR, 'spawned.txt');
    db.data.connectors.push({ id: 'once', name: 'once', url: '', command: [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(mark)}, 'x')`], presetId: null, enabled: true, autoRead: false, addedAt: 0 });
    const [a, b] = await Promise.all([connectorStatuses(), connectorStatuses()]);
    db.data.connectors.pop();
    expect(a.once.state).toBe('error');
    expect(b.once.state).toBe('error');
    expect(await fs.readFile(mark, 'utf8')).toBe('x');
  });

  it('discards a connect that finishes after the apps were dropped', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { DATA_DIR } = await import('./config.js');
    const { db } = await import('./store.js');
    const { connectorStatuses, dropConnections } = await import('./direct/mcp-client.js');
    const mark = path.join(DATA_DIR, 'slow-spawned.txt');
    const sdk = path.resolve('node_modules/@modelcontextprotocol/sdk/dist/cjs/server');
    const script = path.join(DATA_DIR, 'slow-mcp.cjs');
    await fs.writeFile(
      script,
      `require('fs').appendFileSync(${JSON.stringify(mark)}, 'x');
const { McpServer } = require(${JSON.stringify(path.join(sdk, 'mcp.js'))});
const { StdioServerTransport } = require(${JSON.stringify(path.join(sdk, 'stdio.js'))});
const s = new McpServer({ name: 'slow', version: '1.0.0' });
s.tool('ping', 'ping', async () => ({ content: [{ type: 'text', text: 'pong' }] }));
setTimeout(() => s.connect(new StdioServerTransport()), 500);`,
    );
    db.data.connectors.push({ id: 'slow', name: 'slow', url: '', command: [process.execPath, script], presetId: null, enabled: true, autoRead: false, addedAt: 0 });
    try {
      const first = connectorStatuses();
      await vi.waitFor(() => fs.access(mark), { timeout: 5_000 });
      await dropConnections();
      expect((await first).slow.state).toBe('error');
      expect((await connectorStatuses()).slow.state).toBe('connected');
      expect(await fs.readFile(mark, 'utf8')).toBe('xx');
    } finally {
      db.data.connectors.pop();
      await dropConnections();
    }
  }, 20_000);
});

