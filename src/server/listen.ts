import { serve, type ServerType } from '@hono/node-server';

type Fetch = Parameters<typeof serve>[0]['fetch'];

/** Starts an HTTP listener and resolves once it is bound (rejects on EADDRINUSE and the like). */
export function listen(fetch: Fetch, hostname: string, port: number): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname, port }, (info) => resolve({ server, port: info.port }));
    server.once('error', reject);
  });
}

export function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
