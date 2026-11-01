import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Instabox, InstaboxError, type ExecResult, type InstaboxMachine } from './computer/instabox.js';

/** Kilo's evaluation: `*` matches anything, rules apply in order, the last match wins. */
function decide(rules: Record<string, unknown>, tool: string): string {
  let result = 'deny';
  for (const [pattern, action] of Object.entries(rules)) {
    if (typeof action !== 'string') continue;
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(tool)) result = action;
  }
  return result;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Instabox client', () => {
  it('sends the key, replays safely, and never puts the key in an error', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const doFetch = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return json({ error: { code: 'unauthorized', message: 'bad key sk-secret-123' } }, 401);
    }) as unknown as typeof fetch;
    const api = new Instabox('ibk_secret_key', 'https://api.test', doFetch);
    const err = await api.me().catch((e) => e as InstaboxError);
    expect(err).toBeInstanceOf(InstaboxError);
    expect(err.message).toMatch(/didn't accept that API key/);
    expect(err.message).not.toContain('ibk_secret_key');
    expect((seen[0].init.headers as Record<string, string>)['X-API-Key']).toBe('ibk_secret_key');
  });

  it('waits for a power operation to finish', async () => {
    const calls: string[] = [];
    let polls = 0;
    const doFetch = (async (url: URL, init: RequestInit) => {
      calls.push(`${init.method} ${new URL(String(url)).pathname}`);
      if (init.method === 'POST') {
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
        return json({ id: 'op_1', state: 'running' });
      }
      return json({ id: 'op_1', state: ++polls < 2 ? 'running' : 'succeeded' });
    }) as unknown as typeof fetch;
    await new Instabox('k', 'https://api.test', doFetch).power('m_1', 'resume', 30);
    expect(calls).toEqual(['POST /v1/machines/m_1/resume', 'GET /v1/operations/op_1', 'GET /v1/operations/op_1']);
  });

  it('turns a failed operation into a plain message', async () => {
    const doFetch = (async (_u: URL, init: RequestInit) =>
      init.method === 'POST' ? json({ id: 'op_2' }) : json({ id: 'op_2', state: 'failed', error: { message: 'No capacity.' } })) as unknown as typeof fetch;
    await expect(new Instabox('k', 'https://api.test', doFetch).power('m_1', 'start', 30)).rejects.toThrow('No capacity.');
  });
});

describe('browse addresses', () => {
  it('allows the public web only', async () => {
    const { checkBrowseUrl } = await import('./computer/mcp.js');
    expect(checkBrowseUrl('https://example.com/a?b=1')).toMatchObject({ ok: true });
    expect(checkBrowseUrl('http://example.com')).toMatchObject({ ok: true });
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'http://localhost:7777', 'http://127.0.0.1', 'http://169.254.169.254/latest', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.20.0.1', 'http://[::1]/', 'http://metadata.google.internal', 'not a url'])
      expect(checkBrowseUrl(bad), bad).toMatchObject({ ok: false });
  });
});

// ---- the machine module, against a fake Instabox ----

class FakeInstabox extends Instabox {
  calls: { cmd?: string; argv?: string[]; envs?: Record<string, string>; cwd?: string }[] = [];
  files = new Map<string, string>();
  state = 'running';
  power_calls: string[] = [];
  symlinks: Record<string, string> = {};
  fileContent: Record<string, string> = {};
  constructor() {
    super('fake-key', 'http://unused');
  }
  override me = async () => ({ login: 'tester' });
  override listMachines = async (): Promise<InstaboxMachine[]> => [
    { id: 'm_1', name: 'dev', state: this.state, vault: true, template: { id: 'agent-browser' } },
    { id: 'm_2', name: 'plain', state: 'stopped', template: { id: 'universal' } },
  ];
  override getMachine = async (id: string): Promise<InstaboxMachine> => ({ id, name: id === 'm_1' ? 'dev' : 'plain', state: this.state, vault: true });
  override power = async (_id: string, action: 'start' | 'resume') => {
    this.power_calls.push(action);
    this.state = 'running';
  };
  override writeFile = async (_id: string, p: string, content: string) => {
    this.files.set(p, content);
    return content.length;
  };
  override readFile = async (_id: string, p: string) => ({ content: this.fileContent[p] ?? '' });
  override exec = async (_id: string, o: Parameters<Instabox['exec']>[1]): Promise<ExecResult> => {
    this.calls.push(o);
    const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0 });
    if (o.cmd?.includes('VERSION')) return ok(''); // nothing installed yet
    if (o.cmd?.includes('npm i playwright-core')) return ok();
    if (o.argv?.[0] === 'mkdir') return ok();
    if (o.argv?.[0] === 'realpath') {
      const wanted = o.argv.at(-1)!;
      return ok(`${this.symlinks[wanted] ?? path.posix.normalize(wanted)}\n`);
    }
    if (o.argv?.[0] === 'base64') return ok(Buffer.from(this.fileContent[o.argv.at(-1)!] ?? 'hello').toString('base64'));
    if (o.argv?.[1]?.endsWith('duet-browser.mjs')) {
      const action = o.argv[2];
      // Like the live example.com: "Example Domain" is in the title, not in the page text.
      if (action === 'read') return ok('{"ok":true,"url":"https://example.com/","title":"Example Domain","text":"This domain is for use in documentation examples.","elements":[{"ref":1,"kind":"a","label":"More"}]}\n');
      if (action === 'fail') return ok('{"ok":false,"error":"Chromium did not start. Is the desktop running on the machine?"}\n');
      return ok(`{"ok":true,"url":"https://example.com/","title":"Example Domain","status":"started"}\n`);
    }
    return ok('cmd output');
  };
}

let fake: FakeInstabox;
let machine: typeof import('./computer/machine.js');
let store: typeof import('./store.js');
let home: string;

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'threatduet-computer-'));
  process.env.THREATDUET_HOME = home;
  store = await import('./store.js');
  await store.openStore();
  machine = await import('./computer/machine.js');
  fake = new FakeInstabox();
  machine.setClientFactory(() => fake);
});

const settled = async () => {
  for (let i = 0; i < 100; i++) {
    const s = await machine.computerStatus();
    if (!s.setup?.running) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('setup never finished');
};

describe('Duet computer setup and use', () => {
  it('lists machines and marks the ones with a browser and Vault', async () => {
    const choices = await machine.listChoices('anything-long-enough');
    expect(choices).toEqual([
      { id: 'm_1', name: 'dev', state: 'running', vault: true, hasBrowser: true },
      { id: 'm_2', name: 'plain', state: 'stopped', vault: false, hasBrowser: false },
    ]);
  });

  it('connects, installs the driver, starts the browser and checks it can browse', async () => {
    fake.state = 'suspended';
    expect(await machine.connectComputer({ apiKey: 'fake-key-1234', machineId: 'm_1' })).toEqual({ ok: true });
    const s = await settled();
    expect(s).toMatchObject({ connected: true, name: 'dev', machineState: 'running', vault: true, setup: null });
    expect(fake.power_calls).toEqual(['resume']);
    expect([...fake.files.keys()].sort()).toEqual(['/data/home/threatduet/VERSION', '/data/home/threatduet/duet-browser.mjs']);
    expect(fake.files.get('/data/home/threatduet/duet-browser.mjs')).toContain('connectOverCDP');
    expect(JSON.stringify(s)).not.toContain('fake-key');
  });

  it('passes browser arguments as argv, never through a shell', async () => {
    fake.calls.length = 0;
    const evil = `https://example.com/'; rm -rf / #`;
    await machine.browser('open', { url: evil });
    const call = fake.calls.find((c) => c.argv?.[2] === 'open')!;
    expect(call.cmd).toBeUndefined();
    expect(call.argv).toEqual(['node', '/data/home/threatduet/duet-browser.mjs', 'open', JSON.stringify({ url: evil })]);
    expect(call.envs).toEqual({ DISPLAY: ':1' });
  });

  it('explains a missing desktop in plain words', async () => {
    await expect(machine.browser('fail' as never)).rejects.toThrow(/Computer tab in the Instabox dashboard/);
  });

  it('keeps file access inside the working folder, symlinks included', async () => {
    const dir = '/data/workspace/threatduet';
    fake.symlinks[`${dir}/sneaky`] = '/etc';
    await expect(machine.safeVmPath('notes/a.md')).resolves.toBe(`${dir}/notes/a.md`);
    await expect(machine.safeVmPath(`${dir}/b.txt`)).resolves.toBe(`${dir}/b.txt`);
    for (const bad of ['../../etc/passwd', '/etc/passwd', '/data/home/.ssh/id_rsa', 'sneaky', `${dir}/../x`])
      await expect(machine.safeVmPath(bad), bad).rejects.toThrow(/only works inside/);
    // A sibling folder that merely starts with the same letters is outside too.
    await expect(machine.safeVmPath(`${dir}-evil/x`)).rejects.toThrow(/only works inside/);
  });

  it('copies results into the workspace without overwriting protected files', async () => {
    fake.fileContent['/data/workspace/threatduet/report.md'] = '# Report\n';
    await expect(machine.copyToWorkspace('report.md')).resolves.toMatch(/Saved report.md/);
    expect(await fs.readFile(path.join(home, 'workspace', 'report.md'), 'utf8')).toBe('# Report\n');
    await expect(machine.copyToWorkspace('report.md', 'kilo.json')).rejects.toThrow(/Can't save/);
    await expect(machine.copyToWorkspace('report.md', '.git')).rejects.toThrow(/Can't save/);
    await expect(machine.copyToWorkspace('report.md', '../../escape.md')).resolves.toMatch(/Saved escape.md/);
    expect(await fs.readFile(path.join(home, 'workspace', 'escape.md'), 'utf8')).toBe('# Report\n');
  });

  it('gives Duet read access on its own and holds back everything that acts', async () => {
    await store.writeWorkspaceConfig();
    const cfg = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8'));
    const duet = cfg.agent.duet.permission;
    for (const t of ['computer_status', 'computer_browser_read', 'computer_browser_screenshot', 'computer_read_file']) expect(decide(duet, t), t).toBe('allow');
    for (const t of ['computer_browser_open', 'computer_browser_click', 'computer_browser_type', 'computer_browser_press', 'computer_run', 'computer_write_file', 'computer_copy_to_workspace'])
      expect(decide(duet, t), t).toBe('deny');
    expect(duet.webfetch).toBe('deny'); // a computer that may hold logins turns web pages into an approval too
    expect(cfg.agent.code.permission.bash).toBe('deny'); // the Mac never runs a shell for Duet

    store.db.data.settings.openWebPages = true;
    await store.writeWorkspaceConfig();
    const open = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission;
    expect(decide(open, 'computer_browser_open')).toBe('allow');
    expect(decide(open, 'computer_browser_click')).toBe('deny');
    expect(open.webfetch).toBe('allow');
    store.db.data.settings.openWebPages = false;

    // Allow all: every cloud-computer tool runs without a proposal, and Duet is told so.
    store.db.data.computerAuto = true;
    await store.writeWorkspaceConfig();
    const all = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission;
    for (const t of ['computer_browser_open', 'computer_browser_click', 'computer_run', 'computer_write_file']) expect(decide(all, t), t).toBe('allow');
    expect((await import('./connectors.js')).connectedAppsLine()).toMatch(/ALLOW ALL/);
    store.db.data.computerAuto = false;
    await store.writeWorkspaceConfig();
  });

  it('registers its tools for Kilo with a token, in the private config only', async () => {
    const { setComputerPort, computerToken } = await import('./computer/endpoint.js');
    const { writeConnectorsConfig } = await import('./connectors.js');
    setComputerPort(4999);
    await writeConnectorsConfig();
    const file = path.join(home, 'data', 'kilo-connectors.json');
    const mcp = JSON.parse(await fs.readFile(file, 'utf8')).mcp;
    expect(mcp.computer).toEqual({ type: 'remote', url: 'http://127.0.0.1:4999/mcp/computer', headers: { Authorization: `Bearer ${computerToken()}` }, enabled: true });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).not.toContain(computerToken());
  });

  it('disconnects without touching the machine', async () => {
    fake.calls.length = 0;
    fake.power_calls.length = 0;
    await machine.disconnectComputer();
    expect(await machine.computerStatus()).toMatchObject({ connected: false });
    expect(fake.calls).toEqual([]);
    expect(fake.power_calls).toEqual([]);
    const { writeConnectorsConfig } = await import('./connectors.js');
    await writeConnectorsConfig();
    expect(JSON.parse(await fs.readFile(path.join(home, 'data', 'kilo-connectors.json'), 'utf8')).mcp.computer).toBeUndefined();
  });
});

describe("Duet's computer by default", () => {
  it('connects the first machine with a browser on its own, and stays off once the user disconnects', async () => {
    await settled();
    await machine.disconnectComputer();
    expect(store.db.data.computerOptOut).toBe(true);
    expect(await machine.autoConnectComputer()).toBe(false);
    expect(store.db.data.computer).toBeNull();

    store.db.data.computerOptOut = false;
    expect(await machine.autoConnectComputer()).toBe(true);
    expect(store.db.data.computer).toMatchObject({ machineId: 'm_1', name: 'dev' });
    expect(store.db.data.computerOptOut).toBe(false);
    await settled();
    expect(await machine.autoConnectComputer()).toBe(false);
  });

  it('never overrides a disconnect that lands while it is looking for a machine', async () => {
    await machine.disconnectComputer();
    store.db.data.computerOptOut = false;
    const listMachines = fake.listMachines;
    fake.listMachines = async () => {
      await machine.disconnectComputer();
      return listMachines();
    };
    try {
      expect(await machine.autoConnectComputer()).toBe(false);
    } finally {
      fake.listMachines = listMachines;
    }
    expect(store.db.data.computer).toBeNull();
    expect(store.db.data.computerOptOut).toBe(true);
  });
});
