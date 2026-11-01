import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.THREATDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-work-`);
});
vi.mock('./kilo.js', () => ({ runKilo: vi.fn() }));
vi.mock('./notify.js', () => ({ notify: vi.fn() }));
vi.mock('./direct/mcp-client.js', () => ({ openTools: vi.fn(), dropConnections: vi.fn() }));
vi.mock('./direct/permit.js', () => ({ policyFor: async () => ({ tool: (name: string) => name === 'mail_get_messages' ? 'allow' : 'deny', edit: () => 'deny' }) }));

const store = await import('./store.js');
const duet = await import('./duet.js');
const { api } = await import('./api.js');
const { createTask, retrieveKnowledge } = await import('./work.js');
const { recordCall, permittedCall, sameCall } = await import('./receipts.js');
const artifacts = await import('./artifacts.js');
const { pollWatch, watchEvents } = await import('./watches.js');
const { acquireCoordinator } = await import('./coordinator.js');
const { WORKSPACE } = await import('./config.js');
const { runKilo } = await import('./kilo.js');
const { openTools } = await import('./direct/mcp-client.js');
const kilo = vi.mocked(runKilo);
const tools = vi.mocked(openTools);
const result = (text: string) => ({ sessionID: 's1', text, finalText: text, errors: [], tools: [] });
const call = (url: string, body: unknown) => api.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const project = async () => await (await call('/projects', { name: 'Launch', objective: 'Ship', criteria: 'Reviewed release notes' })).json() as import('../shared/types.js').Project;

beforeAll(async () => { vi.stubEnv('NODE_ENV', 'development'); await store.openStore(); });
beforeEach(async () => {
  await duet.idle();
  kilo.mockReset().mockResolvedValue(result('Prepared.'));
  tools.mockReset().mockResolvedValue({ tools: [], close: async () => {} });
  Object.assign(store.db.data, { messages: [], tasks: [], projects: [], channels: [], runs: [], knowledge: [], permissions: [], receipts: [], watches: [], workflows: [], revisions: [], usage: [], threadSession: null, knowledgeMigrated: true });
  delete process.env.THREATDUET_HEADLESS;
});

describe('durable task lifecycle', () => {
  it('keeps continuation and approval pending, then requires outcome confirmation', async () => {
    const task = await createTask({ title: 'Draft', details: '' });
    kilo.mockResolvedValueOnce(result('Drafted. <<ACTIONS\n- send email to Bob\nACTIONS>> <<CONTINUE>>')).mockResolvedValueOnce(result('Prepared the rest.'));
    await duet.startTask(task.id); await duet.idle();
    expect(kilo).toHaveBeenCalledTimes(2);
    expect(task.status).toBe('waiting');
    expect(await duet.completeTask(task.id)).toBe(false);
    expect(store.db.data.runs[0].status).toBe('waiting');
    const proposal = store.db.data.messages.find((m) => m.proposal)!;
    expect(proposal.taskId).toBe(task.id);
    await duet.approve(proposal.id); await duet.idle();
    expect(task.status).toBe('verification');
    expect(await duet.completeTask(task.id)).toBe(true);
    expect(task.status).toBe('done');
  });

  it('marks FAILED approved runs failed, including their task', async () => {
    const task = await createTask({ title: 'Send', details: '' });
    task.status = 'waiting';
    const proposal = await store.post({ role: 'duet', kind: 'task', text: '', taskId: task.id, proposal: { actions: '- send email', status: 'pending' } });
    kilo.mockResolvedValueOnce(result('Delivery failed. <<FAILED>>')).mockResolvedValue(result('Needs review.'));
    await duet.approve(proposal.id); await duet.idle();
    expect(proposal.proposal?.status).toBe('failed');
    expect(task.status).toBe('failed');
  });

  it('stops queued continuations when paused mid-run', async () => {
    const task = await createTask({ title: 'Long work', details: '' });
    let release!: () => void;
    kilo.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(result('More <<CONTINUE>>')); }));
    await duet.startTask(task.id);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await duet.controlTask(task.id, 'pause')).toBe(true);
    expect(kilo.mock.calls[0][0].signal?.aborted).toBe(true);
    release(); await duet.idle();
    expect(task.status).toBe('paused');
    expect(kilo).toHaveBeenCalledTimes(1);
  });

  it('pauses at step limit instead of completing', async () => {
    const task = await createTask({ title: 'Endless', details: '' });
    kilo.mockResolvedValue(result('More <<CONTINUE>>'));
    await duet.startTask(task.id); await duet.idle();
    expect(task.status).toBe('paused');
    expect(kilo).toHaveBeenCalledTimes(duet.MAX_STEPS);
  });

  it('records changed deliverables and waits for criteria verification', async () => {
    const task = await createTask({ title: 'Document', details: '' });
    kilo.mockImplementationOnce(async () => { await fs.writeFile(path.join(WORKSPACE, 'result.md'), 'Finished document'); return result('Saved. <<DELIVERABLE: result.md>>'); });
    await duet.startTask(task.id); await duet.idle();
    expect(task.status).toBe('verification');
    expect(task.deliverables).toEqual(['result.md']);
    expect(store.db.data.revisions.some((r) => r.taskId === task.id && r.path === 'result.md')).toBe(true);
  });

  it('leaves desktop work waiting on headless coordinator', async () => {
    process.env.THREATDUET_HEADLESS = '1';
    const task = await createTask({ title: 'Local files', details: '', device: 'desktop' });
    await duet.startTask(task.id); await duet.idle();
    expect(task.status).toBe('waiting');
    expect(task.reason).toContain('Desktop unavailable');
    expect(kilo).not.toHaveBeenCalled();
  });

  it('preserves projects and marks interrupted work without replay after restart', async () => {
    const p = await project();
    const task = await createTask({ title: 'Run', details: '', projectId: p.id });
    task.status = 'running'; task.startedAt = Date.now();
    store.db.data.receipts.push({ id: crypto.randomUUID(), tool: 'send', arguments: {}, startedAt: Date.now(), endedAt: null, status: 'running', result: '', taskId: task.id });
    await store.db.write(); await store.openStore();
    expect(store.db.data.projects[0].objective).toBe('Ship');
    expect(store.db.data.tasks[0].status).toBe('interrupted');
    expect(store.db.data.receipts[0].status).toBe('uncertain');
    expect(await duet.startTask(task.id)).toBe(false);
    expect(kilo).not.toHaveBeenCalled();
  });
});

describe('projects and knowledge', () => {
  it('preserves project channels and blocks premature project completion', async () => {
    const p = await project();
    expect((await call('/channels/delete', { id: p.channel })).status).toBe(409);
    const task = await createTask({ title: 'Open', details: '', projectId: p.id });
    expect((await call('/projects/control', { id: p.id, action: 'complete' })).status).toBe(409);
    await call('/projects/control', { id: p.id, action: 'pause' });
    expect(task.status).toBe('paused');
    expect(await duet.startTask(task.id)).toBe(false);
    await call('/projects/control', { id: p.id, action: 'resume' });
    expect(task.status).toBe('paused');
  });

  it('retrieves only relevant scopes, keeps metadata on pin, invalidates corrected and forgotten context', async () => {
    const p = await project();
    const saved = await (await call('/knowledge', { text: 'Acme launch is Monday', kind: 'claim', source: 'client email', scope: p.id })).json() as { id: string };
    await call('/knowledge', { text: 'Prefers brief replies', kind: 'preference', source: 'user', pinned: true });
    expect(retrieveKnowledge('launch')).not.toContain('Acme');
    expect(retrieveKnowledge('launch', p.id)).toContain('client email');
    await call('/knowledge/update', { id: saved.id, pinned: true });
    expect(store.db.data.knowledge.find((k) => k.id === saved.id)?.scope).toBe(p.id);
    store.db.data.threadSession = 'old';
    await call('/knowledge/update', { id: saved.id, text: 'Acme launch is Tuesday' });
    expect(retrieveKnowledge('launch', p.id)).not.toContain('Monday');
    expect(store.db.data.threadSession).toBeNull();
    await call('/knowledge/forget', { id: saved.id });
    expect(retrieveKnowledge('launch', p.id)).not.toContain('Acme');
    expect(await store.readMemory()).not.toContain('Acme');
    await store.db.write(); await store.openStore();
    expect(retrieveKnowledge('launch', p.id)).not.toContain('Acme');
  });

  it('searches messages beyond the old 500 message cap', async () => {
    for (let i = 0; i < 502; i++) await store.post({ role: 'user', kind: 'chat', text: i === 0 ? 'launch unique evidence' : `message ${i}` });
    const response = await api.request('/history?q=unique%20evidence');
    expect((await response.json() as { messages: unknown[] }).messages).toHaveLength(1);
  });
});

describe('receipts and exact permissions', () => {
  it('fails a queued exact approval cleanly when its connection disappears', async () => {
    tools.mockRejectedValue(new Error('Connection unavailable'));
    const proposal = await store.post({ role: 'duet', kind: 'chat', text: '', proposal: { actions: 'Send Hello to Bob', status: 'pending', calls: [{ tool: 'mail_send', arguments: { body: 'Hello' } }] } });
    await duet.approve(proposal.id); await duet.idle();
    expect(proposal.proposal?.status).toBe('failed');
  });

  it('shows file differences and rejects stale write previews', async () => {
    const { previewCalls } = await import('./action-previews.js');
    store.db.data.mac.files = true;
    store.db.data.mac.folders = [WORKSPACE];
    const file = path.join(WORKSPACE, 'approved.txt');
    await fs.writeFile(file, 'Original');
    const calls = [{ tool: 'local_files_write', arguments: { path: file, content: 'Replacement' } }];
    const previews = await previewCalls(calls);
    expect(previews[0].before).toBe('Original');
    const write = vi.fn();
    tools.mockResolvedValue({ tools: [{ name: 'local_files_write', description: '', schema: {}, call: write }], close: async () => {} });
    const proposal = await store.post({ role: 'duet', kind: 'chat', text: '', proposal: { actions: 'Replace approved.txt', calls, filePreviews: previews, status: 'pending' } });
    await fs.writeFile(file, 'Changed by user');
    await duet.approve(proposal.id); await duet.idle();
    expect(write).not.toHaveBeenCalled();
    expect(proposal.proposal?.status).toBe('failed');
    expect(await fs.readFile(file, 'utf8')).toBe('Changed by user');
  });

  it('authorizes only the exact shell command for the duration of dispatch', async () => {
    const { runShell } = await import('./mac/shell.js');
    store.db.data.mac.auto = false;
    const command = 'printf receipt';
    expect(await recordCall({ tool: 'local_shell_run', arguments: { command } }, () => runShell(command))).toBe('exit 0\nreceipt');
    await expect(runShell(command)).rejects.toThrow('not in the proposal');
  });

  it('binds permissions to exact arguments and expiry', () => {
    const call = { tool: 'mail_send', arguments: { to: 'bob@example.com', body: 'Hello' } };
    store.db.data.permissions.push({ ...call, id: 'p', expiresAt: Date.now() + 1000 });
    expect(permittedCall({ ...call, arguments: { body: 'Hello', to: 'bob@example.com' } })).toBe(true);
    expect(permittedCall({ ...call, arguments: { ...call.arguments, body: 'Changed' } })).toBe(false);
    store.db.data.permissions[0].expiresAt = Date.now() - 1;
    expect(permittedCall(call)).toBe(false);
    expect(sameCall(call, { ...call, tool: 'other' })).toBe(false);
  });

  it('persists intent before dispatch, blocks uncertain replay, supports explicit reconciliation', async () => {
    const action = { tool: 'mail_send', arguments: { to: 'bob@example.com' } };
    const execute = vi.fn(async () => { expect(store.db.data.receipts[0].status).toBe('running'); throw new Error('Lost response'); });
    await expect(recordCall(action, execute)).rejects.toThrow('Lost response');
    expect(store.db.data.receipts[0].status).toBe('uncertain');
    await expect(recordCall(action, execute)).rejects.toThrow('unresolved receipt');
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await call('/receipts/reconcile', { id: store.db.data.receipts[0].id, status: 'failed', result: 'Provider confirmed no message sent' })).status).toBe(200);
    await recordCall(action, async () => 'message id 123');
    expect(store.db.data.receipts[1].status).toBe('confirmed');
  });

  it('executes exact approved calls once and records their result', async () => {
    const send = vi.fn(async () => 'Sent, message id 123');
    tools.mockResolvedValue({ tools: [{ name: 'mail_send', description: '', schema: {}, call: send }], close: async () => {} });
    const proposal = await store.post({ role: 'duet', kind: 'chat', text: '', proposal: { actions: 'Send Hello to Bob', status: 'pending', calls: [{ tool: 'mail_send', arguments: { body: 'Hello', to: 'bob@example.com' } }] } });
    await duet.approve(proposal.id); await duet.idle();
    expect(send).toHaveBeenCalledWith({ body: 'Hello', to: 'bob@example.com' });
    expect(proposal.proposal?.status).toBe('done');
    expect(store.db.data.receipts[0].proposalId).toBe(proposal.id);
    expect(await duet.approve(proposal.id)).toHaveProperty('error');
  });

  it('forbids unattended permissions and watches from phones', async () => {
    const phone = new Hono<{ Variables: { phone?: boolean } }>();
    phone.use('*', async (c, next) => { c.set('phone', true); await next(); });
    phone.route('/', api);
    const response = await phone.request('/permissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'mail_send', arguments: {}, expiresAt: Date.now() + 1000 }) });
    expect(response.status).toBe(403);
  });
});

describe('watch deduplication and workflows', () => {
  it('baselines old events, dispatches a new event only once across repeated polls and restart', async () => {
    const read = vi.fn().mockResolvedValueOnce(JSON.stringify([{ id: 'old', text: 'client replied' }])).mockResolvedValue(JSON.stringify([{ id: 'old', text: 'client replied' }, { id: 'new', text: 'client replied' }]));
    tools.mockResolvedValue({ tools: [{ name: 'mail_get_messages', description: '', schema: {}, call: read }], close: async () => {} });
    const watch: import('../shared/types.js').Watch = { id: 'watch', title: 'Client reply', tool: 'mail_get_messages', arguments: {}, match: 'replied', workflow: 'Draft a reply', everyMinutes: 5, enabled: true, lastCheck: null, lastSuccess: null, cursor: [], error: null };
    store.db.data.watches.push(watch);
    await pollWatch(watch);
    expect(store.db.data.tasks).toHaveLength(0);
    await pollWatch(watch); await duet.idle();
    await pollWatch(watch); await duet.idle();
    expect(store.db.data.tasks).toHaveLength(1);
    await store.openStore();
    await pollWatch(store.db.data.watches[0]); await duet.idle();
    expect(store.db.data.tasks).toHaveLength(1);
    expect(watch.lastSuccess).toBeTypeOf('number');
  });

  it('fails closed on write tools and deduplicates opaque objects regardless of key order', async () => {
    const run = vi.fn();
    tools.mockResolvedValue({ tools: [{ name: 'mail_send', description: '', schema: {}, call: run }], close: async () => {} });
    await expect(pollWatch({ id: 'bad', title: 'Bad', tool: 'mail_send', arguments: {}, match: '', workflow: 'Bad', enabled: true, everyMinutes: 5, lastCheck: null, lastSuccess: null, cursor: [], error: null })).rejects.toThrow('unattended reads');
    expect(run).not.toHaveBeenCalled();
    expect(watchEvents('{"a":1,"b":2}')[0].id).toBe(watchEvents('{"b":2,"a":1}')[0].id);
  });

  it('saves only confirmed work and creates an unstarted workflow task', async () => {
    const task = await createTask({ title: 'Meeting prep', details: 'Read agenda', criteria: 'Brief reviewed' });
    expect((await call('/workflows/save', { id: task.id, name: 'Meeting prep' })).status).toBe(409);
    await duet.completeTask(task.id);
    const saved = await (await call('/workflows/save', { id: task.id, name: 'Meeting prep' })).json() as { id: string };
    expect((await call('/workflows/run', { id: saved.id, inputs: 'Acme' })).status).toBe(200);
    expect(store.db.data.tasks[0]).toMatchObject({ status: 'suggested', workflowId: saved.id, criteria: 'Brief reviewed' });
    expect(kilo).not.toHaveBeenCalled();
  });
});

describe('artifact integrity and coordinator ownership', () => {
  it('uploads unique documents, downloads exact bytes and keeps old approval cards visible', async () => {
    const form = new FormData();
    form.set('file', new File(['# Uploaded\n'], 'document.md', { type: 'text/markdown' }));
    const response = await api.request('/artifacts/upload', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    const uploaded = await response.json() as { path: string };
    expect(uploaded.path).toMatch(/^uploads\/.+-document.md$/);
    const download = await api.request(`/artifacts/download?path=${encodeURIComponent(uploaded.path)}`);
    expect(await download.text()).toBe('# Uploaded\n');
    const approval = await store.post({ role: 'duet', kind: 'chat', text: 'Old approval', proposal: { actions: '- send email', status: 'pending' } });
    for (let i = 0; i < 201; i++) store.db.data.messages.push({ id: String(i), ts: Date.now(), role: 'user', kind: 'chat', text: 'later' });
    const state = await (await api.request('/state')).json() as { messages: { id: string }[] };
    expect(state.messages.some((m) => m.id === approval.id)).toBe(true);
  });

  it('restores selected bytes, preserves overwritten content and rejects traversal and symlinks', async () => {
    const raw = 'revision.txt';
    await fs.writeFile(path.join(WORKSPACE, raw), 'version one\n');
    await artifacts.snapshotArtifact(raw, 'test');
    const first = store.db.data.revisions[0];
    await fs.writeFile(path.join(WORKSPACE, raw), 'version two\n');
    await artifacts.restoreRevision(first.id);
    expect(await fs.readFile(path.join(WORKSPACE, raw), 'utf8')).toBe('version one\n');
    expect(store.db.data.revisions.some((r) => r.source === 'before restore')).toBe(true);
    await expect(artifacts.artifactPath('../data/state.json')).rejects.toThrow();
    await expect(artifacts.artifactPath('kilo.json')).rejects.toThrow();
    await fs.symlink('/tmp', path.join(WORKSPACE, 'escape'));
    await expect(artifacts.artifactPath('escape/file.txt')).rejects.toThrow();
    await fs.unlink(path.join(WORKSPACE, 'escape'));
  });

  it('allows one coordinator and releases ownership on close', async () => {
    const release = await acquireCoordinator();
    await expect(acquireCoordinator()).rejects.toThrow('already using');
    await release();
    await (await acquireCoordinator())();
  });
});
