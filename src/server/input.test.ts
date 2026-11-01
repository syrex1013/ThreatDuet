import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./notify.js', () => ({ notify: vi.fn() }));

const { cancelInput, openInput, requestInput, respondInput } = await import('./input.js');

describe('interactive input prompt', () => {
  afterEach(() => {
    const open = openInput();
    if (open) cancelInput(open.id);
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
});
