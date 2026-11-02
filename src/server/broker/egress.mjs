// Public IPv4 HTTP(S) only. DNS is resolved once per connection and the connection uses that exact address.
import http from 'node:http';
import net from 'node:net';
import { Resolver } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

function publicResolver() {
  // gVisor often cannot reach Docker embedded DNS at 127.0.0.11.
  const resolver = new Resolver();
  resolver.setServers((process.env.DUET_DNS_SERVERS ?? '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()).filter(Boolean));
  return (host) => resolver.resolve4(host);
}

const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix);
export const publicIPv4 = (address) => net.isIPv4(address) && !blocked.check(address, 'ipv4');

export function createEgress(deniedHosts = [], lookup = publicResolver()) {
  const deny = ['api.instabox.sh', 'instabox.sh', 'metadata.google.internal', ...deniedHosts].map((s) => s.toLowerCase());
  async function destination(host) {
    const normalized = host.toLowerCase().replace(/\.$/, '');
    if (deny.some((d) => normalized === d || normalized.endsWith(`.${d}`))) throw Error('Blocked destination');
    const addresses = net.isIP(normalized) ? [normalized] : await lookup(normalized);
    if (!addresses.length || addresses.some((a) => !publicIPv4(a))) throw Error('Blocked address');
    return addresses[0];
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'http:' || (url.port && url.port !== '80') || url.username || url.password) throw Error('Blocked URL');
      const address = await destination(url.hostname);
      const headers = { ...request.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request({ host: address, port: 80, method: request.method, path: url.pathname + url.search, headers, timeout: 60_000 }, (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream);
    } catch { response.writeHead(403); response.end('Destination blocked'); }
  });
  server.on('connect', async (request, client, head) => {
    try {
      if (!/^[a-zA-Z0-9.-]+:443$/.test(request.url ?? '')) throw Error('Blocked tunnel');
      const address = await destination(request.url.slice(0, -4));
      const upstream = net.connect({ host: address, port: 443 });
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.on('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    } catch { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.maxConnections = 64;
  server.requestTimeout = 60_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) createEgress((process.env.DUET_BLOCKED_HOSTS ?? '').split(',').filter(Boolean)).listen(3128, '0.0.0.0');
