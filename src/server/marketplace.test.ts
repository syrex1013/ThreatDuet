import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildInstall } from '../shared/market.js';
import { planFor } from './market.js';
import { discoverMcp, parseMcpConfig } from './mcp-import.js';
import { parseGithubUrl, parseSkillMd } from './skills.js';

// config.ts reads THREATDUET_HOME when first imported, which happens before any test body runs.
const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const h = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/threatduet-market-`);
  process.env.THREATDUET_HOME = h;
  return h;
});

describe('registry entry to install plan', () => {
  it('npm: adds -y, pins the version, turns variables into fields', () => {
    const plan = planFor({
      name: 'io.x/fs',
      packages: [
        {
          registryType: 'npm',
          identifier: 'fs-mcp',
          version: '1.2.3',
          runtimeHint: 'npx',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'TOKEN', isRequired: true, isSecret: true }, { name: 'MODE', default: 'ro' }],
          packageArguments: [{ type: 'positional', valueHint: 'directory', isRequired: true }],
        },
      ],
    });
    expect(plan?.type).toBe('local');
    if (plan?.type !== 'local') return;
    expect(plan.argv).toEqual(['npx', '-y', 'fs-mcp@1.2.3', { field: 'arg0' }]);
    expect(plan.fields.map((f) => [f.key, f.secret, f.required])).toEqual([['TOKEN', true, true], ['MODE', false, false], ['arg0', false, true]]);
    expect(buildInstall(plan, {})).toEqual({ error: expect.stringContaining('TOKEN') });
    expect(buildInstall(plan, { TOKEN: 't', arg0: '/tmp' })).toEqual({ command: ['npx', '-y', 'fs-mcp@1.2.3', '/tmp'], env: { TOKEN: 't', MODE: 'ro' } });
  });

  it('pypi runs through uvx; oci passes variables to docker', () => {
    const py = planFor({ name: 'a/b', packages: [{ registryType: 'pypi', identifier: 'mcp-thing', version: '0.4.0', transport: { type: 'stdio' } }] });
    expect(py && py.type === 'local' && py.argv).toEqual(['uvx', 'mcp-thing==0.4.0']);
    const oci = planFor({ name: 'a/c', packages: [{ registryType: 'oci', identifier: 'ghcr.io/o/i:1', environmentVariables: [{ name: 'KEY', isRequired: true }] }] });
    expect(oci && oci.type === 'local' && oci.argv).toEqual(['docker', 'run', '-i', '--rm', '-e', 'KEY', 'ghcr.io/o/i:1']);
  });

  it('remote: static headers stay, a variable header becomes a secret field', () => {
    const plan = planFor({
      name: 'a/r',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer {key}', isSecret: true, isRequired: true }, { name: 'X-Ver', value: '2' }] }],
    });
    expect(plan?.type).toBe('remote');
    if (plan?.type !== 'remote') return;
    expect(buildInstall(plan, { Authorization: 'abc' })).toEqual({ url: 'https://mcp.example.com/mcp', headers: { 'X-Ver': '2', Authorization: 'Bearer abc' } });
  });

  it('skips what it cannot run safely', () => {
    expect(planFor({ name: 'a/n', packages: [{ registryType: 'nuget', identifier: 'x' }] })).toBeNull();
    expect(planFor({ name: 'a/h', remotes: [{ type: 'streamable-http', url: 'http://plain.example.com/mcp' }] })).toBeNull();
    expect(planFor({ name: 'a/v', remotes: [{ type: 'sse', url: 'https://{region}.example.com/mcp' }] })).toBeNull();
    expect(planFor({ name: 'a/x', packages: [{ registryType: 'npm', identifier: 'x', runtimeHint: 'bash' }] })).toBeNull();
    expect(planFor({ name: 'a/t', packages: [{ registryType: 'npm', identifier: 'x', transport: { type: 'streamable-http' } }] })).toBeNull();
  });
});

describe('skill files and links', () => {
  it('reads the header, including folded descriptions', () => {
    expect(parseSkillMd('---\nname: my-skill\ndescription: "Does a thing"\n---\nBody here')).toEqual({ name: 'my-skill', description: 'Does a thing', body: 'Body here' });
    expect(parseSkillMd('---\nname: a\ndescription: >\n  one\n  two\n---\nx')).toMatchObject({ description: 'one two' });
    expect(parseSkillMd('no header')).toHaveProperty('error');
    expect(parseSkillMd('---\nname: Bad Name\ndescription: x\n---\n')).toHaveProperty('error');
    expect(parseSkillMd('---\nname: ok\n---\n')).toHaveProperty('error');
  });

  it('understands GitHub folder links and nothing else', () => {
    expect(parseGithubUrl('https://github.com/anthropics/skills/tree/main/skills/pdf')).toEqual({ repo: 'anthropics/skills', ref: 'main', path: 'skills/pdf' });
    expect(parseGithubUrl('https://github.com/o/r/blob/dev/x/SKILL.md')).toEqual({ repo: 'o/r', ref: 'dev', path: 'x' });
    expect(parseGithubUrl('https://github.com/o/r')).toEqual({ repo: 'o/r', ref: 'HEAD', path: '' });
    for (const bad of ['http://github.com/o/r', 'https://evil.com/o/r', 'https://github.com/o', 'nope']) expect(parseGithubUrl(bad)).toHaveProperty('error');
  });
});

describe('importing Claude and Codex configs', () => {
  it('reads .mcp.json, a bare map and Codex TOML', () => {
    const json = JSON.stringify({ mcpServers: { mail: { command: 'npx', args: ['-y', 'mail-mcp'], env: { K: 'v' } }, web: { type: 'http', url: 'https://x.example/mcp', headers: { A: 'b' } } } });
    expect(parseMcpConfig(json)).toEqual([
      { name: 'mail', command: ['npx', '-y', 'mail-mcp'], env: { K: 'v' } },
      { name: 'web', url: 'https://x.example/mcp', headers: { A: 'b' } },
    ]);
    expect(parseMcpConfig(JSON.stringify({ cal: { command: 'cal-mcp' } }))).toEqual([{ name: 'cal', command: ['cal-mcp'], env: undefined }]);
    const toml = '[mcp_servers.cal]\ncommand = "uvx"\nargs = ["cal-mcp"]\nenv = { TOKEN = "t" }\n';
    expect(parseMcpConfig(toml)).toEqual([{ name: 'cal', command: ['uvx', 'cal-mcp'], env: { TOKEN: 't' } }]);
    expect(parseMcpConfig('{{ not config')).toEqual([]);
  });

  it('lists what is on this computer without any secret values', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'threatduet-home-'));
    await fs.writeFile(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { mail: { command: 'mail-mcp', env: { SECRET_TOKEN: 'hunter2' } } } }));
    const found = await discoverMcp(home);
    expect(found).toEqual([{ key: 'claude:mail', source: 'Claude', name: 'mail', line: 'mail-mcp', envKeys: ['SECRET_TOKEN'] }]);
    expect(JSON.stringify(found)).not.toContain('hunter2');
    await fs.rm(home, { recursive: true, force: true });
  });
});

describe('local servers and skills in the store', () => {
  let store: typeof import('./store.js');
  let connectors: typeof import('./connectors.js');
  let skills: typeof import('./skills.js');
  beforeAll(async () => {
    store = await import('./store.js');
    await store.openStore();
    connectors = await import('./connectors.js');
    skills = await import('./skills.js');
  });

  it('runs a local program only after confirmation, as an argv', async () => {
    expect(await connectors.addConnector({ name: 'Mail', command: ['npx', '-y', 'mail-mcp'] })).toHaveProperty('error');
    expect(await connectors.addConnector({ name: 'Mail', command: [] , confirmed: true })).toHaveProperty('error');
    expect(await connectors.addConnector({ name: 'Mail', command: ['x'], env: { 'BAD NAME': '1' }, confirmed: true })).toHaveProperty('error');
    const r = await connectors.addConnector({ name: 'Mail', command: ['npx', '-y', 'mail-mcp'], env: { TOKEN: 't' }, confirmed: true });
    expect(r).toEqual({ id: 'mail' });
    const cfg = JSON.parse(await fs.readFile(path.join(home, 'data', 'kilo-connectors.json'), 'utf8'));
    expect(cfg.mcp.mail).toEqual({ type: 'local', command: ['npx', '-y', 'mail-mcp'], environment: { TOKEN: 't' }, enabled: true });
    const info = (await connectors.connectorsResponse()).connectors.find((c) => c.id === 'mail');
    expect(info).toMatchObject({ kind: 'local', site: 'npx' });
  }, 30_000);

  it('installs a pasted skill into the sandbox, and removes it again', async () => {
    const md = '---\nname: tone\ndescription: Write in my tone\n---\nBe brief.';
    expect(await skills.installSkill({ text: md })).toEqual({ name: 'tone' });
    await store.writeWorkspaceConfig();
    const placed = path.join(home, 'workspace', '.kilo', 'skills', 'tone', 'SKILL.md');
    expect(await fs.readFile(placed, 'utf8')).toBe(md);
    await skills.updateSkill('tone', false);
    await store.writeWorkspaceConfig();
    await expect(fs.access(placed)).rejects.toThrow();
    await skills.updateSkill('tone', true);
    await store.resetSandbox();
    expect(await fs.readFile(placed, 'utf8')).toBe(md);
    expect(await skills.removeSkill('tone')).toBe(true);
    await store.writeWorkspaceConfig();
    await expect(fs.access(placed)).rejects.toThrow();
    expect(await skills.installSkill({ text: 'no header' })).toHaveProperty('error');
  });
});
