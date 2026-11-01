import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let api: typeof import('./api.js')['api'];
let workspace: string;

beforeAll(async () => {
  // config.ts reads this at import time, so set it before loading any server module.
  process.env.OPENDUET_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'openduet-test-'));
  await (await import('./store.js')).openStore();
  workspace = (await import('./config.js')).WORKSPACE;
  api = (await import('./api.js')).api;
});

describe('GET /files', () => {
  it('lists workspace files newest first, without symlinks or Kilo config', async () => {
    await fs.mkdir(path.join(workspace, 'sub'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.kilo/skills/x'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'report.md'), '# Report');
    await fs.writeFile(path.join(workspace, 'sub/dash.html'), '<h1>Dash</h1>');
    await fs.writeFile(path.join(workspace, '.kilo/skills/x/SKILL.md'), 'skill');
    await fs.symlink(os.tmpdir(), path.join(workspace, 'out'));
    const now = Date.now() / 1000;
    await fs.utimes(path.join(workspace, 'report.md'), now - 60, now - 60);
    await fs.utimes(path.join(workspace, 'sub/dash.html'), now, now);

    const res = await api.request('/files');
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: { path: string; size: number; mtime: number }[] };
    expect(files.map((f) => f.path)).toEqual(['sub/dash.html', 'report.md']);
    expect(files[1].size).toBe(8);
  });

  it('skips dependency folders and unreadable folders instead of failing', async () => {
    await fs.mkdir(path.join(workspace, 'node_modules/pkg'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'node_modules/pkg/index.js'), '');
    await fs.mkdir(path.join(workspace, 'locked'));
    await fs.writeFile(path.join(workspace, 'locked/secret.txt'), 'x');
    await fs.chmod(path.join(workspace, 'locked'), 0o000);
    try {
      const res = await api.request('/files');
      expect(res.status).toBe(200);
      const paths = ((await res.json()) as { files: { path: string }[] }).files.map((f) => f.path);
      expect(paths).toContain('report.md');
      expect(paths.some((p) => p.startsWith('node_modules/') || p.startsWith('locked/'))).toBe(false);
    } finally {
      await fs.chmod(path.join(workspace, 'locked'), 0o755);
    }
  });
});
