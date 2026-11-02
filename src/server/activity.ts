import { randomUUID } from 'node:crypto';
import { db } from './store.js';
import { stateChanged } from './events.js';
import type { RunEvent, RunEventStatus } from '../shared/types.js';
import { guard } from './policy.js';
const MAX = 40;
export function emitRunEvent(taskId: string | undefined, status: RunEventStatus, title: string, description: string, startedAt = Date.now()): RunEvent | null {
  if (!taskId) return null;
  const task = db.data.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const safe = (value: string, limit: number) => guard(value) || /\bibk_[a-z0-9]+/i.test(value) ? '[sensitive activity omitted]' : value.trim().slice(0, limit);
  const event: RunEvent = { id: randomUUID(), at: Date.now(), status, title: safe(title, 120), description: safe(description, 300), elapsedMs: Math.max(0, Date.now() - startedAt) };
  const prior = task.activity ?? [];
  if (prior.at(-1)?.status === event.status && prior.at(-1)?.title === event.title && prior.at(-1)?.description === event.description) return prior.at(-1) ?? null;
  task.activity = [...prior, event].slice(-MAX); stateChanged(); void db.write(); return event;
}
