import { AsyncLocalStorage } from 'node:async_hooks';
import { stateChanged } from './events.js';
import { emitRunEvent } from './activity.js';
import { db } from './store.js';
import { guard } from './policy.js';

export interface ActiveRun { runId?: string; taskId?: string; channel?: string; signal?: AbortSignal; onProgress?: (detail: string) => void; modelProgress?: string }
const storage = new AsyncLocalStorage<ActiveRun>();
const active = new Map<string, ActiveRun>();
let sequence = 0;
const keyFor = (run: ActiveRun) => `${run.runId || run.taskId || 'run'}-${++sequence}`;
export const withActiveRun = <T>(run: ActiveRun, work: () => Promise<T>) => {
  const key = registerActiveRun(run);
  return storage.run(run, async () => { try { return await work(); } finally { unregisterActiveRun(key); } });
};
export const activeRun = () => storage.getStore();
export const registerActiveRun = (run: ActiveRun) => { const key = keyFor(run); active.set(key, run); return key; };
export const unregisterActiveRun = (key: string) => { active.delete(key); };
const fallbackRun = () => active.size === 1 ? [...active.values()][0] : undefined;
export const resolvedRun = () => activeRun() ?? fallbackRun();
export function reportProgress(status: string, title: string, description: string): string {
  const run = resolvedRun();
  if (!run) return 'No active run.';
  if (guard(`${title}\n${description}`) || /\bibk_[a-z0-9]+/i.test(`${title}\n${description}`)) return 'Sensitive progress rejected.';
  const event = emitRunEvent(run.taskId, status as import('../shared/types.js').RunEventStatus, title, description);
  const task = run.taskId ? db.data.tasks.find((task) => task.id === run.taskId) : undefined;
  if (task && event) { task.modelProgress = event; void db.write(); }
  run.modelProgress = `${title.trim().slice(0, 120)}: ${description.trim().slice(0, 300)}`;
  run.onProgress?.(run.modelProgress);
  stateChanged();
  return `Progress recorded: ${status}`;
}

export function runtimeProgress(detail: string, callback?: (detail: string) => void): void {
  if (!resolvedRun()?.modelProgress) callback?.(detail);
}

/** Objective metadata is separate from activity so a status update cannot erase task instructions. */
export function updateTaskMetadata(title: string): string {
  const run = resolvedRun();
  const task = run?.taskId ? db.data.tasks.find((task) => task.id === run.taskId) : undefined;
  if (!task) return 'No active task.';
  if (task.titleEdited) return 'User-edited task metadata preserved.';
  if (guard(title)) return 'Sensitive metadata rejected.';
  task.title = title.trim().slice(0, 120);
  void db.write();
  return 'Task objective metadata updated.';
}
