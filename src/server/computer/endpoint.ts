import { randomBytes } from 'node:crypto';

/**
 * Where Kilo reaches Duet's computer tools: an MCP endpoint inside this server, protected by a token
 * that is new on every start. Kept in its own module so connectors and the endpoint can both use it.
 */
const token = randomBytes(32).toString('base64url');
let port: number | null = null;

export const computerToken = () => token;

export function setComputerPort(p: number): void {
  port = p;
}

export const computerEndpoint = (): { url: string; headers: Record<string, string> } | null =>
  port === null ? null : { url: `http://127.0.0.1:${port}/mcp/computer`, headers: { Authorization: `Bearer ${token}` } };

/** The Mac's own tools (files, shell, Brave) share the token and the server, on another path. */
export const macEndpoint = (): { url: string; headers: Record<string, string> } | null =>
  port === null ? null : { url: `http://127.0.0.1:${port}/mcp/mac`, headers: { Authorization: `Bearer ${token}` } };

/** Past-chat search and other meta tools that live inside this process. */
export const duetEndpoint = (): { url: string; headers: Record<string, string> } | null =>
  port === null ? null : { url: `http://127.0.0.1:${port}/mcp/duet`, headers: { Authorization: `Bearer ${token}` } };
