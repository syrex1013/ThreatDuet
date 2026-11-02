import { describe, expect, it } from 'vitest';
import { BrokerClient, brokerUrl } from './broker-client.js';

describe('private broker transport', () => {
  it('requires HTTPS and refuses credentials, paths, and query tokens in broker URLs', () => {
    for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com/?token=secret']) expect(() => brokerUrl(url)).toThrow();
    expect(brokerUrl('https://example.com/')).toBe('https://example.com');
  });
  it('sends only authenticated operation and never retries uncertain writes', async () => {
    const seen: RequestInit[] = [];
    const client = new BrokerClient({ url: 'https://broker.example.com', token: 'installation-secret', tenantId: 'cannot-select-tenant', name: 'User' }, (async (_url, request) => {
      seen.push(request!);
      throw new Error('Connection lost.');
    }) as typeof fetch);
    await expect(client.operation('exec', { cmd: 'side effect' })).rejects.toThrow(/Outcome may be uncertain/);
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe('error');
    expect(JSON.parse(seen[0].body as string)).toEqual({ operation: 'exec', arguments: { cmd: 'side effect' }, manual: false });
    expect(JSON.stringify(seen[0].body)).not.toContain('cannot-select-tenant');
  });
});
