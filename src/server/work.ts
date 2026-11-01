import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { TaskItem } from '../shared/types.js';
import { db } from './store.js';
import { MEMORY_FILE } from './config.js';
import { verifyArtifact } from './artifacts.js';

export const taskProject = (task: TaskItem) => db.data.projects.find((p) => p.id === task.projectId);

export function retrieveKnowledge(query: string, scope?: string): string {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return db.data.knowledge
    .filter((k) => k.scope === 'personal' || k.scope === scope)
    .map((k) => ({ k, score: (k.pinned ? 100 : 0) + words.filter((word) => k.text.toLocaleLowerCase().includes(word)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.k.updatedAt - a.k.updatedAt)
    .slice(0, 20)
    .map(({ k }) => `[${k.kind}; ${k.source}; ${new Date(k.updatedAt).toISOString()}; ${k.scope}] ${k.text}`)
    .join('\n').slice(0, 12_000) || '(none)';
}

export async function refreshMemory(): Promise<void> {
  await fs.writeFile(MEMORY_FILE, '# What Duet remembers about you\n' + db.data.knowledge.map((k) => `- ${k.text}\n`).join(''));
}

export function syncRun(task: TaskItem): void {
  const run = db.data.runs.find((r) => r.id === task.runId);
  if (!run) return;
  run.status = task.status;
  run.summary = task.reason ?? '';
  if (!['running', 'queued'].includes(task.status)) run.endedAt = Date.now();
}

export async function finishTask(task: TaskItem): Promise<void> {
  if (db.data.messages.some((m) => m.taskId === task.id && ['pending', 'approved', 'waiting', 'blocked', 'interrupted'].includes(m.proposal?.status ?? ''))) {
    task.status = 'waiting'; task.reason = 'Approval or reconciliation is still pending.'; return;
  }
  const receipts = db.data.receipts.filter((r) => r.taskId === task.id);
  if (receipts.some((r) => r.status === 'uncertain' || r.status === 'running')) {
    task.status = 'waiting'; task.reason = 'Review action receipts before continuing.'; return;
  }
  const paths = [...new Set([...(task.deliverables ?? []), ...db.data.revisions.filter((r) => r.taskId === task.id).map((r) => r.path)])];
  task.deliverables = [];
  for (const path of paths) if (await verifyArtifact(path)) task.deliverables.push(path);
  const project = taskProject(task);
  if (project) for (const file of task.deliverables) if (!project.files.includes(file)) project.files.push(file);
  // Evidence proves an output exists; the user verifies whether it meets their criteria.
  task.status = 'verification';
  task.reason = task.deliverables.length || receipts.length ? 'Results saved. Check completion criteria, then confirm.' : 'No deliverable or confirmed external result. Review before marking done.';
}

export async function createTask(input: Pick<TaskItem, 'title' | 'details'> & Partial<Pick<TaskItem, 'projectId' | 'criteria' | 'workflowId' | 'device'>>): Promise<TaskItem> {
  const project = input.projectId ? db.data.projects.find((p) => p.id === input.projectId) : undefined;
  if (input.projectId && !project) throw new Error('Project not found.');
  const task: TaskItem = { ...input, id: randomUUID(), channel: project?.channel, status: 'suggested', createdAt: Date.now(), startedAt: null, doneAt: null };
  db.data.tasks.unshift(task);
  await db.write();
  return task;
}
