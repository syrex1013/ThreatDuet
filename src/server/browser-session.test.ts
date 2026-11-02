import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  local: vi.fn(), cloud: vi.fn(), input: vi.fn(), cookies: vi.fn(), imports: vi.fn(), topUp: vi.fn(),
  data: { mac: { browser: true }, computer: null as unknown, cloudBroker: { tenantId: 'private-user' } as unknown },
}));
vi.mock('./store.js', () => ({ db: { data: mocks.data } }));
vi.mock('./mac/browser.js', () => ({ browse: mocks.local, exportCookies: mocks.cookies, topUpSignins: mocks.topUp }));
vi.mock('./computer/machine.js', () => ({ browser: mocks.cloud, importSessionCookies: mocks.imports }));
vi.mock('./input.js', () => ({ requestInput: mocks.input }));
vi.mock('./i18n.js', () => ({ tr: (text: string, vars: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) }));
const { askAndFill, pushSessionToComputer } = await import('./browser-session.js');

beforeEach(() => { vi.resetAllMocks(); mocks.topUp.mockResolvedValue(0); mocks.data.mac.browser = true; });
describe('picking up sign-ins from the user\'s own browser', () => {
  const page = { url: 'https://example.com/login', title: 'Login', token: 'document:node', kind: 'password' };
  it('skips the prompt and reloads when the user\'s browser held a sign-in Duet lacked', async () => {
    mocks.local.mockResolvedValue(page);
    mocks.topUp.mockResolvedValue(3);
    await expect(askAndFill({ target: 'local', kind: 'password', prompt: 'Login', ref: 4 })).resolves.toMatch(/Added 3 sign-ins/);
    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.local).toHaveBeenCalledWith('open', { url: 'https://example.com/login' });
  });
  it('asks as before when there was nothing new, and never looks for non-login fields or cloud pages', async () => {
    mocks.local.mockResolvedValue(page);
    mocks.input.mockResolvedValue('secret');
    await askAndFill({ target: 'local', kind: 'password', prompt: 'Login', ref: 4 });
    expect(mocks.topUp).toHaveBeenCalledOnce();
    expect(mocks.input).toHaveBeenCalledOnce();
    expect(mocks.local).toHaveBeenLastCalledWith('fill-input', expect.objectContaining({ text: 'secret' }));
    mocks.topUp.mockClear();
    mocks.local.mockResolvedValue({ ...page, kind: undefined });
    await askAndFill({ target: 'local', kind: 'otp', prompt: 'Code', ref: 2 });
    mocks.cloud.mockResolvedValue(page);
    await askAndFill({ target: 'computer', kind: 'password', prompt: 'Login', ref: 4 });
    expect(mocks.topUp).not.toHaveBeenCalled();
  });
});
describe('secure credential binding', () => {
  it('captures original field before waiting and sends secret only to bound private browser', async () => {
    let respond!: (value: string) => void;
    mocks.cloud.mockImplementation(async (action: string) => action === 'read' ? { url: 'https://example.com/login' } : action === 'inspect-input' ? { url: 'https://example.com/login', token: 'original-document:original-node' } : {});
    mocks.input.mockImplementation(() => new Promise<string>((resolve) => { respond = resolve; }));
    const pending = askAndFill({ target: 'computer', kind: 'password', prompt: 'Login', ref: 4 });
    await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledOnce());
    expect(mocks.cloud.mock.calls.map(([action]) => action)).toEqual(['read', 'inspect-input']);
    respond('private-secret');
    const result = await pending;
    expect(mocks.cloud).toHaveBeenLastCalledWith('fill-input', expect.objectContaining({ token: 'original-document:original-node', url: 'https://example.com/login', text: 'private-secret' }));
    expect(result).not.toContain('private-secret');
    expect(JSON.stringify(mocks.input.mock.calls)).not.toContain('private-secret');
  });
  it('does not fill cancelled prompts or rebind stale fields', async () => {
    mocks.local.mockResolvedValue({ url: 'https://example.com', token: 'original' });
    mocks.input.mockResolvedValue(null);
    await expect(askAndFill({ target: 'local', kind: 'otp', prompt: 'Code', ref: 2 })).rejects.toThrow(/cancelled/);
    expect(mocks.local.mock.calls.some(([action]) => action === 'fill-input')).toBe(false);
    mocks.input.mockResolvedValue('123456');
    mocks.local.mockImplementation(async (action: string) => { if (action === 'fill-input') throw new Error('The page changed while waiting for input.'); return { url: 'https://example.com', token: 'original' }; });
    await expect(askAndFill({ target: 'local', kind: 'otp', prompt: 'Code', ref: 2 })).rejects.toThrow(/page changed/);
    expect(mocks.local.mock.calls.filter(([action]) => action === 'inspect-input')).toHaveLength(2);
  });
  it('copies cookies only for an explicit credential-free origin', async () => {
    for (const origin of ['https://user:password@example.com', 'https://example.com/login', 'https://example.com/?token=value', 'file:///etc/passwd']) await expect(pushSessionToComputer(origin)).rejects.toThrow();
    mocks.cookies.mockResolvedValue([{ name: 'session', value: 'private', domain: 'example.com' }]);
    mocks.imports.mockResolvedValue({ count: 1 });
    await expect(pushSessionToComputer('https://example.com')).resolves.toMatch(/Copied/);
    expect(mocks.cookies).toHaveBeenCalledWith('https://example.com');
  });
});
