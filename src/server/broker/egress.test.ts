import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { createEgress, publicIPv4 } from './egress.mjs';

describe('egress policy', () => {
  it('allows public IPv4 only', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1']) expect(publicIPv4(ip)).toBe(false);
    expect(publicIPv4('8.8.8.8')).toBe(true);
  });
  it('blocks denied hosts and mixed DNS answers', async () => {
    const server = createEgress(['broker.internal'], async (host: string) => host === 'mixed.test' ? ['8.8.8.8', '192.168.1.1'] : ['8.8.8.8']);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    const get = (host: string) => new Promise<number>((resolve) => { const req = http.request({ host: '127.0.0.1', port, path: `http://${host}/`, headers: { host } }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }); req.on('error', () => resolve(0)); req.end(); });
    expect(await get('broker.internal')).toBe(403);
    expect(await get('mixed.test')).toBe(403);
    server.close();
  });
  it('rejects metadata, non-http, and CONNECT management targets', async () => {
    const server = createEgress([], async () => ['169.254.169.254']);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    const status = await new Promise<number>((resolve) => { const req = http.request({ host: '127.0.0.1', port, path: 'http://metadata.google.internal/' }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }); req.end(); });
    expect(status).toBe(403); server.close();
  });
});
