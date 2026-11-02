import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./notify.js', () => ({ notify: vi.fn() }));

const { cancelInput, cancelInputs, openInput, openInputs, requestInput, respondInput } = await import('./input.js');

describe('interactive input prompt', () => {
  afterEach(() => {
    cancelInputs();
    vi.useRealTimers();
  });

  it('resolves when the user responds and never keeps the value in openInput', async () => {
    const pending = requestInput({ kind: 'password', prompt: 'Sign in to GitHub', target: 'local', ref: 3 });
    const shown = openInput();
    expect(shown).toMatchObject({ kind: 'password', prompt: 'Sign in to GitHub', target: 'local', ref: 3 });
    expect(respondInput(shown!.id, 's3cret')).toBe(true);
    await expect(pending).resolves.toBe('s3cret');
    expect(openInput()).toBeNull();
  });

  it('resolves null when cancelled', async () => {
    const pending = requestInput({ kind: 'otp', prompt: '2FA', target: 'computer' });
    const id = openInput()!.id;
    expect(cancelInput(id)).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it('keeps simultaneous prompts independent', async () => {
    const first = requestInput({ kind: 'text', prompt: 'first', target: 'local', channel: 'a' });
    const second = requestInput({ kind: 'otp', prompt: 'second', target: 'computer', channel: 'b' });
    const prompts = openInputs();
    expect(prompts).toHaveLength(2);
    expect(respondInput(prompts[1].id, '222')).toBe(true);
    expect(cancelInputs({ channel: 'a' })).toBe(1);
    await expect(second).resolves.toBe('222');
    await expect(first).resolves.toBeNull();
  });

  it('cancels on abort without affecting other prompts', async () => {
    const controller = new AbortController();
    const aborted = requestInput({ kind: 'text', prompt: 'abort', target: 'local', signal: controller.signal });
    const retained = requestInput({ kind: 'text', prompt: 'keep', target: 'local' });
    controller.abort();
    await expect(aborted).resolves.toBeNull();
    expect(openInputs()).toHaveLength(1);
    cancelInput(openInput()!.id);
    await expect(retained).resolves.toBeNull();
  });
  it('expires prompts and inherits task ownership without retaining navigation secrets', async () => {
    vi.useFakeTimers();
    const { withActiveRun } = await import('./run-context.js');
    const run = withActiveRun({ taskId: 'owned-task', channel: 'owned-channel' }, () => requestInput({ kind: 'otp', prompt: 'Code', target: 'computer', url: 'https://example.com/login?code=private-navigation' }));
    expect(openInput()).toMatchObject({ taskId: 'owned-task', channel: 'owned-channel', origin: 'https://example.com' });
    expect(JSON.stringify(openInputs())).not.toContain('private-navigation');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(run).resolves.toBeNull();
    expect(openInputs()).toHaveLength(0);
  });
});
