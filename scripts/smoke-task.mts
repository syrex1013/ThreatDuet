// A real Duet task on this computer: the live model, the real Mac/PC tools (files, a command), the real
// permission file. Fails (exit 1) when a tool errors, the run stops, or the answer misses the user name.
// Run: npx tsx scripts/smoke-task.mts   (uses a throwaway OPENDUET_HOME unless one is set)
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPENDUET_HOME ??= mkdtempSync(path.join(os.tmpdir(), 'openduet-smoke-'));
const store = await import('../src/server/store.js');
await store.openStore();
store.db.data.settings.kiloMode = 'direct';
const model = process.env.OPENDUET_SMOKE_MODEL ?? store.db.data.settings.model;
const { setMac } = await import('../src/server/mac/settings.js');
await setMac({ files: true, everything: true, shell: true, auto: true });
const { runKilo } = await import('../src/server/kilo.js');
const { osLine } = await import('../src/server/mac/os.js');

const win = process.platform === 'win32';
const prompt = `${osLine()}\n\nDo these two things with the tools, then report:\n1. With local_shell_run, run a ${win ? 'PowerShell' : 'shell'} command that prints the current user name and the OS version.\n2. With local_files_list, list the user's home folder.\nAnswer with the exact command you ran, its output, and the first three entries of the home folder. No <<ACTIONS>> are needed: everything is allowed.`;
const t = Date.now();
const r = await runKilo({ prompt, model, agent: 'duet', onProgress: (d) => console.log('  …', d) });
const used = r.tools.map((x) => `${x.tool}:${x.status}`);
console.log(`\nmodel ${model} on ${process.platform}, ${Math.round((Date.now() - t) / 1000)}s\ntools: ${used.join(', ')}\nerrors: ${r.errors.join(' | ') || 'none'}\n---\n${r.finalText}\n---`);
const user = os.userInfo().username;
const problems = [
  ...r.errors.map((e) => `run error: ${e}`),
  ...r.tools.filter((x) => x.status === 'error').map((x) => `tool failed: ${x.tool}`),
  used.some((u) => u.startsWith('local_shell_run:')) ? '' : 'local_shell_run was not used',
  used.some((u) => u.startsWith('local_files_list:')) ? '' : 'local_files_list was not used',
  r.finalText.toLowerCase().includes(user.toLowerCase()) ? '' : `answer does not mention the user name ${user}`,
].filter(Boolean);
if (problems.length) {
  console.error(`FAIL\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('OK');
