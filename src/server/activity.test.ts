import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';

process.env.THREATDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-activity-`);
const store = await import('./store.js');
const { emitRunEvent } = await import('./activity.js');
const { withActiveRun, reportProgress, runtimeProgress, updateTaskMetadata, registerActiveRun, unregisterActiveRun } = await import('./run-context.js');

beforeAll(() => store.openStore());
beforeEach(() => { store.db.data.tasks = [{ id: '11111111-1111-4111-8111-111111111111', title: 'Manual', details: 'Keep', status: 'running', createdAt: 0, startedAt: 0, doneAt: null }]; });

describe('run activity', () => {
  it('scopes, deduplicates, and bounds events', () => {
    const id = store.db.data.tasks[0].id;
    emitRunEvent(id, 'acting', 'Work', 'one'); emitRunEvent(id, 'acting', 'Work', 'one');
    for (let i = 0; i < 50; i++) emitRunEvent(id, 'acting', `Work ${i}`, 'step');
    expect(store.db.data.tasks[0].activity).toHaveLength(40);
    expect(store.db.data.tasks[0].activity?.[0].title).toBe('Work 10');
  });
  it('preserves manual title while updating activity', async () => {
    const task = store.db.data.tasks[0]; task.titleEdited = true;
    await withActiveRun({ taskId: task.id }, async () => reportProgress('acting', 'Generated', 'Details'));
    expect(task.title).toBe('Manual'); expect(task.activity?.at(-1)?.title).toBe('Generated');
  });
  it('rejects ambiguous active context', () => {
    expect(reportProgress('acting', 'Nope', 'No run')).toBe('No active run.');
    const first = registerActiveRun({ taskId: 'a' }), second = registerActiveRun({ taskId: 'b' });
    expect(reportProgress('acting', 'Nope', 'Ambiguous')).toBe('No active run.');
    unregisterActiveRun(first); unregisterActiveRun(second);
  });
  it('keeps model status during tool execution and updates objective metadata separately', async () => {
    const task = store.db.data.tasks[0];
    const progress: string[] = [];
    await withActiveRun({ taskId: task.id, onProgress: (detail) => progress.push(detail) }, async () => {
      reportProgress('planning', 'Review sources', 'Check actual evidence.');
      runtimeProgress('reading a file', (detail) => progress.push(detail));
      expect(task.title).toBe('Manual');
      updateTaskMetadata('Prepare source review');
      expect(task.title).toBe('Prepare source review');
      task.titleEdited = true;
      expect(updateTaskMetadata('Override')).toMatch(/preserved/);
      expect(reportProgress('acting', 'password=do-not-store', 'secret')).toMatch(/rejected/);
    });
    expect(progress).toEqual(['Review sources: Check actual evidence.']);
    expect(task.modelProgress?.title).toBe('Review sources');
    expect(JSON.stringify(task.activity)).not.toContain('do-not-store');
  });
});
