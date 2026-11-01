import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const home = await vi.hoisted(async () => {
  const { mkdtempSync, realpathSync } = await import('node:fs');
  const h = realpathSync(mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/openduet-mac-`));
  process.env.OPENDUET_HOME = h;
  return h;
});

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

let store: typeof import('./store.js');
let files: typeof import('./mac/files.js');
let shell: typeof import('./mac/shell.js');
let settings: typeof import('./mac/settings.js');
let duet: typeof import('./duet.js');
const docs = path.join(home, 'docs');

beforeAll(async () => {
  store = await import('./store.js');
  await store.openStore();
  files = await import('./mac/files.js');
  shell = await import('./mac/shell.js');
  settings = await import('./mac/settings.js');
  duet = await import('./duet.js');
  await fs.mkdir(path.join(docs, 'sub'), { recursive: true });
  await fs.writeFile(path.join(docs, 'note.txt'), 'meeting with Acme on Friday');
  await fs.writeFile(path.join(docs, 'sub', 'plan.md'), 'quarterly plan');
  await fs.writeFile(path.join(home, 'outside.txt'), 'secret');
  await fs.symlink(path.join(home, 'outside.txt'), path.join(docs, 'link.txt'));
});

describe('what Duet may do on its own with the Mac tools', () => {
  const read = ['mac_files_list', 'mac_files_read', 'mac_files_search', 'mac_browser_read', 'mac_browser_screenshot'];
  const ask = ['mac_files_write', 'mac_shell_run', 'mac_browser_click', 'mac_browser_type', 'mac_browser_press'];

  it('reads freely, and everything that changes something is denied, with an app connected too', async () => {
    await settings.setMac({ files: true, shell: true, browser: true });
    await store.writeWorkspaceConfig();
    const cfg = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8'));
    const rules = cfg.agent.duet.permission;
    for (const t of read) expect(decide(rules, t), t).toBe('allow');
    for (const t of ask) expect(decide(rules, t), t).toBe('deny');
    expect(decide(rules, 'mac_browser_open')).toBe('deny');
    expect(rules.webfetch).toBe('deny');
    store.db.data.settings.openWebPages = true;
    await store.writeWorkspaceConfig();
    const open = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission;
    expect(decide(open, 'mac_browser_open')).toBe('allow');
    store.db.data.settings.openWebPages = false;
    await settings.setMac({ files: false, shell: false, browser: false });
  });

  it('the Mac counts as a connected account: web fetching needs approval once it is on', async () => {
    await settings.setMac({ files: true });
    await store.writeWorkspaceConfig();
    expect(JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission.webfetch).toBe('deny');
    await settings.setMac({ files: false });
    await store.writeWorkspaceConfig();
    expect(JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission.webfetch).toBe('allow');
  });
});

describe('files', () => {
  it('stays inside the added folders, follows links, and keeps credentials out', async () => {
    await expect(files.listFolder(docs)).rejects.toThrow(/turned off/);
    await settings.setMac({ files: true });
    await expect(files.listFolder(docs)).rejects.toThrow(/outside the folders/);
    expect(await settings.addFolder(docs)).toEqual({ ok: true });
    expect(await files.listFolder(docs)).toContain('note.txt');
    expect(await files.readText(path.join(docs, 'note.txt'))).toBe('meeting with Acme on Friday');
    await expect(files.readText(path.join(docs, 'sub', '..', '..', 'outside.txt'))).rejects.toThrow(/outside/);
    await expect(files.readText(path.join(docs, 'link.txt'))).rejects.toThrow(/outside/);
    await expect(files.readText('relative.txt')).rejects.toThrow(/full path/);
    expect(await files.searchFiles('friday')).toContain('note.txt');
    expect(await files.searchFiles('plan')).toContain('plan.md');
    expect(await files.writeText(path.join(docs, 'new', 'out.txt'), 'hi')).toContain('Wrote');
    await expect(files.writeText(path.join(home, 'evil.txt'), 'x')).rejects.toThrow(/outside/);
  });

  it('refuses the data folder and ~/.ssh even when a parent folder was added', async () => {
    await settings.addFolder(home);
    await expect(files.readText(path.join(home, 'data', 'state.json'))).rejects.toThrow(/passwords or keys/);
    await settings.removeFolder(home);
    const realHome = os.homedir();
    expect(await settings.addFolder(realHome)).toEqual({ ok: true });
    await expect(files.listFolder(path.join(realHome, '.ssh'))).rejects.toThrow(/passwords or keys/);
    await expect(files.readText(path.join(realHome, '.claude.json'))).rejects.toThrow(/passwords or keys|does not exist/);
    await expect(files.listFolder(path.join(realHome, 'Library/Keychains'))).rejects.toThrow(/passwords or keys|does not exist/);
    await settings.removeFolder(await fs.realpath(realHome));
    await settings.setMac({ files: false });
  });
});

describe('whole disk', () => {
  it('can be added, and system credential stores stay off-limits', async () => {
    await settings.setMac({ files: true });
    expect(await settings.addFolder('/')).toEqual({ ok: true });
    expect(await files.listFolder('/Users')).toContain('dir');
    await expect(files.listFolder('/Library/Keychains')).rejects.toThrow(/passwords or keys|does not exist/);
    await expect(files.readText('/private/var/db/dslocal')).rejects.toThrow(/passwords or keys|does not exist/);
    await settings.removeFolder('/');
    await settings.setMac({ files: false });
  });
});

describe('everything', () => {
  it('opens any folder with no list, keeps credential stores out, and the folder list rules again once off', async () => {
    await settings.setMac({ files: true, everything: true });
    expect(await files.readText(path.join(home, 'outside.txt'))).toBe('secret');
    expect(await files.listFolder(os.homedir())).toContain('dir');
    await expect(files.readText(path.join(home, 'data', 'state.json'))).rejects.toThrow(/passwords or keys/);
    await expect(files.writeText(path.join(home, 'workspace', 'kilo.json'), '{}')).rejects.toThrow(/own configuration/);
    await expect(files.writeText(path.join(home, 'workspace', 'notes', 'AGENTS.md'), 'x')).rejects.toThrow(/own configuration/);
    if (process.platform !== 'linux') await expect(files.writeText(path.join(home, 'workspace', 'notes', 'KILO.JSON'), '{}')).rejects.toThrow(/own configuration/);
    expect(await files.writeText(path.join(home, 'workspace', 'notes', 'kilo-notes.md'), 'x')).toContain('Wrote');
    await expect(files.listFolder(path.join(os.homedir(), '.ssh'))).rejects.toThrow(/passwords or keys|does not exist/);
    expect(await files.searchFiles('quarterly', docs)).toContain('plan.md');
    expect((await settings.macStatus()).everything).toBe(true);
    await settings.setMac({ everything: false });
    await expect(files.readText(path.join(home, 'outside.txt'))).rejects.toThrow(/outside the folders/);
    await settings.setMac({ files: false });
  });

  it('is told to Duet', async () => {
    const { connectedAppsLine } = await import('./connectors.js');
    await settings.setMac({ files: true, everything: true });
    expect(connectedAppsLine()).toMatch(/anywhere on the/);
    await settings.setMac({ everything: false });
    expect(connectedAppsLine()).toMatch(/in these folders only/);
    await settings.setMac({ files: false });
  });
});

describe('auto mode', () => {
  it('allows every Mac tool, runs commands without a proposal, and is told to Duet', async () => {
    await settings.setMac({ files: true, shell: true, browser: true, auto: true });
    await store.writeWorkspaceConfig();
    const rules = JSON.parse(await fs.readFile(path.join(home, 'workspace', 'kilo.json'), 'utf8')).agent.duet.permission;
    for (const t of ['mac_files_write', 'mac_shell_run', 'mac_browser_open', 'mac_browser_click', 'mac_browser_type', 'mac_browser_press']) expect(decide(rules, t), t).toBe('allow');
    shell.clearCommands();
    expect(await shell.runShell('echo auto')).toContain('auto');
    expect((await import('./connectors.js')).connectedAppsLine()).toMatch(/AUTO MODE/);
    await settings.setMac({ auto: false });
    await expect(shell.runShell('echo auto')).rejects.toThrow(/not in the proposal/);
    await settings.setMac({ files: false, shell: false, browser: false });
  });
});

describe('commands', () => {
  it('runs only commands that are in the approved text, exactly', async () => {
    await expect(shell.runShell('echo hi')).rejects.toThrow(/not in the proposal/);
    shell.allowCommands('Please run:\n```sh\necho hello\n```\nand\n```\nls /tmp\npwd\n```');
    expect(await shell.runShell('echo hello')).toContain('hello');
    expect(await shell.runShell('pwd')).toContain('exit 0');
    expect(await shell.runShell('pwd', path.join(home, 'no-such-folder'))).toMatch(/^exit failed\n\S/);
    shell.allowCommands('```\necho kept; kill -9 $$\n```');
    expect(await shell.runShell('echo kept; kill -9 $$')).toMatch(/^exit failed\n[^]*kept/);
    shell.allowCommands('Please run:\n```sh\necho hello\n```\nand\n```\nls /tmp\npwd\n```');
    await expect(shell.runShell('echo hello && rm -rf ~')).rejects.toThrow(/not in the proposal/);
    await expect(shell.runShell('echo other')).rejects.toThrow(/not in the proposal/);
    shell.clearCommands();
    await expect(shell.runShell('echo hello')).rejects.toThrow(/not in the proposal/);
    expect(shell.hasCommands('no commands here')).toBe(false);
    expect(shell.hasCommands('```\nls\n```')).toBe(true);
    expect(shell.commandsIn('run ```echo hi``` now')).toEqual([]);
    expect(shell.hasCommands('run ```echo hi``` now')).toBe(true);
    expect(shell.commandsIn('```bash\nls -la\n```')).toContain('ls -la');
  });

  it('a paired phone cannot approve a proposal that runs commands', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    store.db.data.messages.push({ id, ts: Date.now(), role: 'duet', kind: 'chat', text: 'x', proposal: { actions: '```\nls ~\n```', status: 'pending' } } as never);
    expect(await duet.approve(id, true)).toEqual({ error: expect.stringContaining('only be approved on this computer'), status: 403 });
    expect(store.db.data.messages.find((m) => m.id === id)?.proposal?.status).toBe('pending');
    await duet.reject(id);
  });
});
