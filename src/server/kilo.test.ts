import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KiloResult } from './parse.js';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.OPENDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/openduet-kilo-`);
});

vi.mock('./direct/available.js', () => ({ useDirect: async () => true, kiloInstalled: async () => false }));
vi.mock('./direct/runtime.js', () => ({ runDirect: vi.fn() }));

const { runDirect } = await import('./direct/runtime.js');
const store = await import('./store.js');
await store.openStore();
const { runKilo } = await import('./kilo.js');
const direct = vi.mocked(runDirect);
const result = (r: Partial<KiloResult>): KiloResult => ({ sessionID: 'dir_1', text: '', finalText: '', tools: [], errors: [], ...r });

describe('runKilo recovers once', () => {
  beforeEach(() => direct.mockReset());

  it('resumes a run that died without an answer, in its session, naming the error', async () => {
    direct.mockResolvedValueOnce(result({ errors: ['kilo timed out'] })).mockResolvedValueOnce(result({ text: 'done', finalText: 'done' }));
    const r = await runKilo({ prompt: 'do x', model: 'm', agent: 'duet' });
    expect(r.text).toBe('done');
    expect(r.errors).toEqual([]);
    expect(direct).toHaveBeenCalledTimes(2);
    expect(direct.mock.calls[1][0]).toMatchObject({ session: 'dir_1', prompt: expect.stringMatching(/stopped before answering \(kilo timed out\)/) });
  });

  it('resumes after a crash too, repeating the task when no session survived', async () => {
    direct.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(result({ text: 'ok', finalText: 'ok' }));
    const r = await runKilo({ prompt: 'do y', model: 'm', agent: 'duet' });
    expect(r.text).toBe('ok');
    expect(direct.mock.calls[1][0]).toMatchObject({ session: null, prompt: expect.stringMatching(/\(boom\)[^]*The task was:\ndo y/) });
  });

  it('gives up after the second failure, keeping both errors, and never re-runs approved actions without a session', async () => {
    direct.mockResolvedValueOnce(result({ errors: ['first'] })).mockResolvedValueOnce(result({ errors: ['second'] }));
    expect((await runKilo({ prompt: 'z', model: 'm', agent: 'duet' })).errors).toEqual(['first', 'second']);
    direct.mockReset();
    direct.mockResolvedValueOnce(result({ sessionID: null, errors: ['gone'] }));
    await expect(runKilo({ prompt: 'send it', model: 'm', agent: 'code', auto: true })).rejects.toThrow('gone');
    expect(direct).toHaveBeenCalledTimes(1);
  });

  it('leaves a run that answered alone', async () => {
    direct.mockResolvedValueOnce(result({ text: 'fine', finalText: 'fine', errors: ['Stopped after 40 steps.'] }));
    const r = await runKilo({ prompt: 'q', model: 'm', agent: 'duet' });
    expect(r.text).toBe('fine');
    expect(direct).toHaveBeenCalledTimes(1);
  });
});
