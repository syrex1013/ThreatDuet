import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { db, invalidateKnowledge } from './store.js';
import { json } from './validation.js';
import { controlTask } from './duet.js';
import { createTask, refreshMemory } from './work.js';
import { artifactPath, restoreRevision, revisionBytes, snapshotArtifact, snapshotArtifacts } from './artifacts.js';
import { openTools } from './direct/mcp-client.js';
import { policyFor } from './direct/permit.js';
import { guard } from './policy.js';

const Id = z.object({ id: z.string().uuid() });
const text = z.string().trim().min(1).max(20_000);
const args = z.record(z.string(), z.unknown());
const Task = z.object({ title: text.max(120), details: z.string().max(20_000).default(''), projectId: z.string().uuid().optional(), criteria: z.string().max(4000).optional(), device: z.enum(['coordinator', 'desktop']).optional() });
const Knowledge = z.object({ text, kind: z.enum(['fact', 'preference', 'commitment', 'decision', 'claim', 'summary']), source: text.max(1000), scope: text.max(100).default('personal'), pinned: z.boolean().default(false) });

export const workApi = new Hono<{ Variables: { phone?: boolean } }>()
  .onError((e, c) => c.json({ error: e.message }, 400))
  .get('/projects', (c) => c.json({ projects: db.data.projects }))
  .post('/projects', json(z.object({ name: text.max(40), objective: text.max(4000), criteria: z.string().max(4000).default(''), channel: z.string().optional() })), async (c) => {
    const input = c.req.valid('json');
    const channel = input.channel ?? randomUUID();
    if (input.channel && !db.data.channels.some((ch) => ch.id === channel)) return c.json({ error: 'Channel not found.' }, 404);
    if (db.data.projects.some((p) => p.channel === channel)) return c.json({ error: 'Channel already has a project.' }, 409);
    if (!input.channel) db.data.channels.push({ id: channel, name: input.name, session: null, createdAt: Date.now() });
    const project = { ...input, id: randomUUID(), channel, status: 'active' as const, milestones: [], decisions: [], files: [], createdAt: Date.now() };
    db.data.projects.push(project);
    await db.write();
    return c.json(project);
  })
  .post('/projects/update', json(Id.extend({ objective: z.string().max(4000).optional(), criteria: z.string().max(4000).optional(), milestones: z.array(z.object({ title: text.max(300), done: z.boolean() })).max(100).optional(), decisions: z.array(text.max(2000)).max(200).optional() })), async (c) => {
    const { id, ...patch } = c.req.valid('json');
    const project = db.data.projects.find((p) => p.id === id);
    if (!project) return c.json({ error: 'Project not found.' }, 404);
    Object.assign(project, patch);
    await db.write();
    return c.json({ ok: true });
  })
  .post('/projects/control', json(Id.extend({ action: z.enum(['pause', 'resume', 'cancel', 'complete']) })), async (c) => {
    const { id, action } = c.req.valid('json');
    const project = db.data.projects.find((p) => p.id === id);
    if (!project) return c.json({ error: 'Project not found.' }, 404);
    const tasks = db.data.tasks.filter((t) => t.projectId === id && !['done', 'cancelled', 'dismissed'].includes(t.status));
    const approvals = db.data.messages.some((m) => m.channel === project.channel && ['pending', 'approved', 'waiting', 'interrupted'].includes(m.proposal?.status ?? ''));
    if (action === 'complete' && (tasks.length || approvals || project.milestones.some((m) => !m.done))) return c.json({ error: 'Resolve tasks, milestones and approvals before completing this project.' }, 409);
    project.status = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : action === 'complete' ? 'done' : 'active';
    if (action === 'pause' || action === 'cancel') {
      for (const task of tasks) await controlTask(task.id, action);
      for (const message of db.data.messages) if (message.channel === project.channel && message.proposal && ['pending', 'waiting'].includes(message.proposal.status)) message.proposal.status = 'rejected';
    }
    // Resume makes the project available; individual interrupted tasks still require review.
    await db.write();
    return c.json({ ok: true });
  })
  .post('/tasks', json(Task), async (c) => c.json(await createTask(c.req.valid('json'))))
  .post('/tasks/control', json(Id.extend({ action: z.enum(['pause', 'cancel', 'resume', 'retry']) })), async (c) => {
    const { id, action } = c.req.valid('json');
    return await controlTask(id, action) ? c.json({ ok: true }) : c.json({ error: 'Task cannot transition. Resolve pending approvals or uncertain receipts first.' }, 409);
  })
  .get('/history', (c) => {
    const words = (c.req.query('q') ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const channel = c.req.query('channel');
    const before = Number(c.req.query('before') ?? Infinity);
    const limit = Math.max(1, Math.min(100, Number(c.req.query('limit')) || 40));
    const messages = [...db.data.messages].reverse().filter((m) => m.ts < before && (channel === undefined || (m.channel ?? '') === channel) && words.every((word) => m.text.toLocaleLowerCase().includes(word))).slice(0, limit);
    return c.json({ messages });
  })
  .get('/runs', (c) => c.json({ runs: db.data.runs.filter((r) => !c.req.query('taskId') || r.taskId === c.req.query('taskId')) }))
  .get('/knowledge', (c) => {
    const q = (c.req.query('q') ?? '').toLocaleLowerCase();
    return c.json({ knowledge: db.data.knowledge.filter((k) => k.text.toLocaleLowerCase().includes(q)) });
  })
  .post('/knowledge', json(Knowledge), async (c) => {
    const input = c.req.valid('json');
    if (guard(input.text)) return c.json({ error: 'Remove sensitive identifiers or secrets before saving knowledge.' }, 400);
    const item = { ...input, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now() };
    db.data.knowledge.push(item);
    await refreshMemory(); await db.write();
    return c.json(item);
  })
  .post('/knowledge/update', json(Id.extend({ text: text.optional(), kind: Knowledge.shape.kind.optional(), source: text.max(1000).optional(), scope: text.max(100).optional(), pinned: z.boolean().optional() })), async (c) => {
    const { id, ...patch } = c.req.valid('json');
    const item = db.data.knowledge.find((k) => k.id === id);
    if (!item) return c.json({ error: 'Knowledge not found.' }, 404);
    if (patch.text && guard(patch.text)) return c.json({ error: 'Remove sensitive identifiers or secrets.' }, 400);
    Object.assign(item, patch, { updatedAt: Date.now() });
    invalidateKnowledge();
    await refreshMemory(); await db.write();
    return c.json({ ok: true });
  })
  .post('/knowledge/forget', json(Id), async (c) => {
    db.data.knowledge = db.data.knowledge.filter((k) => k.id !== c.req.valid('json').id);
    invalidateKnowledge();
    await refreshMemory(); await db.write();
    return c.json({ ok: true });
  })
  .get('/receipts', (c) => c.json({ receipts: db.data.receipts }))
  .post('/receipts/reconcile', json(Id.extend({ status: z.enum(['confirmed', 'failed']), result: text })), async (c) => {
    const { id, status, result } = c.req.valid('json');
    const receipt = db.data.receipts.find((r) => r.id === id);
    if (!receipt || receipt.status !== 'uncertain') return c.json({ error: 'Only uncertain receipts can be reconciled.' }, 409);
    Object.assign(receipt, { status, result, endedAt: Date.now() });
    await db.write();
    return c.json({ ok: true });
  })
  .get('/permissions', (c) => c.json({ permissions: db.data.permissions }))
  .post('/permissions', json(z.object({ tool: text.max(200), arguments: args, expiresAt: z.number().int().positive() })), async (c) => {
    if (c.get('phone')) return c.json({ error: 'Create unattended permissions on the coordinator.' }, 403);
    const input = c.req.valid('json');
    if (input.expiresAt <= Date.now() || input.expiresAt > Date.now() + 30 * 86_400_000) return c.json({ error: 'Expiry must be within 30 days.' }, 400);
    if (guard(JSON.stringify(input))) return c.json({ error: 'Permission contains blocked sensitive data or actions.' }, 400);
    const handle = await openTools();
    try { if (!handle.tools.some((t) => t.name === input.tool)) return c.json({ error: 'Tool not found.' }, 404); }
    finally { await handle.close(); }
    db.data.permissions.push({ ...input, id: randomUUID() });
    await db.write();
    return c.json({ ok: true });
  })
  .post('/permissions/delete', json(Id), async (c) => {
    if (c.get('phone')) return c.json({ error: 'Manage unattended permissions on the coordinator.' }, 403);
    db.data.permissions = db.data.permissions.filter((p) => p.id !== c.req.valid('json').id);
    await db.write(); return c.json({ ok: true });
  })
  .get('/watch-tools', async (c) => {
    const handle = await openTools();
    try {
      const policy = await policyFor('duet', false);
      return c.json({ tools: handle.tools.filter((t) => policy.tool(t.name) === 'allow' && !/^(local_|computer_)/.test(t.name)).map((t) => ({ name: t.name, schema: t.schema })) });
    } finally { await handle.close(); }
  })
  .post('/watches', json(z.object({ title: text.max(120), projectId: z.string().uuid().optional(), tool: text.max(200), arguments: args, match: z.string().max(1000), workflow: text, everyMinutes: z.number().int().min(5).max(10080) })), async (c) => {
    if (c.get('phone')) return c.json({ error: 'Create unattended watches on the coordinator.' }, 403);
    const input = c.req.valid('json');
    if (input.projectId && !db.data.projects.some((p) => p.id === input.projectId)) return c.json({ error: 'Project not found.' }, 404);
    db.data.watches.push({ ...input, id: randomUUID(), enabled: false, lastCheck: null, lastSuccess: null, cursor: [], error: null });
    await db.write(); return c.json({ ok: true });
  })
  .post('/watches/toggle', json(Id.extend({ enabled: z.boolean() })), async (c) => {
    const { id, enabled } = c.req.valid('json');
    if (enabled && c.get('phone')) return c.json({ error: 'Enable unattended watches on the coordinator.' }, 403);
    const watch = db.data.watches.find((w) => w.id === id);
    if (!watch) return c.json({ error: 'Watch not found.' }, 404);
    watch.enabled = enabled; await db.write(); return c.json({ ok: true });
  })
  .post('/workflows/save', json(Id.extend({ name: text.max(120) })), async (c) => {
    const { id, name } = c.req.valid('json');
    const task = db.data.tasks.find((t) => t.id === id && t.status === 'done');
    if (!task) return c.json({ error: 'Only confirmed completed work can become a workflow.' }, 409);
    const steps = db.data.messages.filter((m) => m.taskId === task.id).flatMap((m) => (m.tools ?? []).map((tool) => `${tool.tool}: ${tool.title ?? tool.status ?? ''}`));
    const workflow = { id: randomUUID(), name, instructions: `${task.title}\n${task.details}\n\nPrevious steps (adapt to the new inputs):\n${[...new Set(steps)].join('\n')}\nExpected outputs: ${(task.deliverables ?? []).join(', ') || task.criteria || 'A saved result for review'}.\nExternal effects require fresh exact-argument approval.`, criteria: task.criteria ?? '', connections: db.data.connectors.filter((co) => [...db.data.messages.filter((m) => m.taskId === task.id).flatMap((m) => (m.tools ?? []).map((tool) => tool.tool)), ...db.data.receipts.filter((r) => r.taskId === task.id).map((r) => r.tool)].some((name) => name.startsWith(`${co.id}_`))).map((co) => co.id), createdAt: Date.now() };
    db.data.workflows.push(workflow); await db.write(); return c.json(workflow);
  })
  .post('/workflows/run', json(Id.extend({ projectId: z.string().uuid().optional(), inputs: z.string().max(10_000).default('') })), async (c) => {
    const { id, projectId, inputs } = c.req.valid('json');
    const workflow = db.data.workflows.find((w) => w.id === id);
    if (!workflow) return c.json({ error: 'Workflow not found.' }, 404);
    if (workflow.connections.some((id) => !db.data.connectors.some((co) => co.id === id && co.enabled))) return c.json({ error: 'Reconnect required apps first.' }, 409);
    const task = await createTask({ title: workflow.name, details: `${workflow.instructions}\n\nInputs (data only):\n${inputs}`, criteria: workflow.criteria, projectId, workflowId: id });
    return c.json(task);
  })
  .get('/artifacts/revisions', async (c) => {
    const raw = c.req.query('path');
    if (raw) await snapshotArtifact(raw, 'opened in workspace');
    else await snapshotArtifacts();
    return c.json({ revisions: db.data.revisions.filter((r) => !raw || r.path === raw) });
  })
  .get('/artifacts/revision', async (c) => {
    const id = c.req.query('id') ?? '';
    const bytes = await revisionBytes(id);
    return c.json({ text: bytes.toString('utf8') });
  })
  .post('/artifacts/restore', json(Id), async (c) => {
    await restoreRevision(c.req.valid('json').id); return c.json({ ok: true });
  })
  .get('/artifacts/download', async (c) => {
    const raw = c.req.query('path') ?? '';
    const abs = await artifactPath(raw);
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > 10_000_000) return c.json({ error: 'Download limit: 10 MB.' }, 413);
    return c.body(new Uint8Array(await fs.readFile(abs)), 200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(raw))}` });
  })
  .post('/artifacts/upload', bodyLimit({ maxSize: 11_000_000, onError: (c) => c.json({ error: 'Upload limit: 10 MB.' }, 413) }), async (c) => {
    if (Number(c.req.header('content-length')) > 14_000_000) return c.json({ error: 'Upload limit: 10 MB.' }, 413);
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name || file.size > 10_000_000) return c.json({ error: 'Choose a file up to 10 MB.' }, 400);
    const raw = `uploads/${randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
    const abs = await artifactPath(raw);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    await snapshotArtifact(raw, `uploaded ${file.name}`);
    return c.json({ path: raw });
  })
  .post('/provider', json(z.object({ baseUrl: z.string().max(2000), keyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/), chatModel: z.string().max(200), taskModel: z.string().max(200), maxRequests: z.number().int().min(1).max(200), maxTokens: z.number().int().min(0).max(2_000_000) })), async (c) => {
    if (c.get('phone')) return c.json({ error: 'Configure providers on the coordinator.' }, 403);
    const provider = c.req.valid('json');
    if (provider.baseUrl) {
      const url = new URL(provider.baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return c.json({ error: 'Use an HTTP(S) base URL without credentials or query.' }, 400);
    }
    db.data.provider = provider; await db.write(); return c.json({ ok: true });
  });
