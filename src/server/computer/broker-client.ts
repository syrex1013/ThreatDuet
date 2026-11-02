import { z } from 'zod';
import { resolvedRun } from '../run-context.js';

export interface BrokerIdentity { url: string; token: string; tenantId: string; name: string }
export interface BrokerStatus { tenant: { id: string; name: string }; available: boolean; reason: string | null; execution: string; queuePosition: number; browserMode?: 'automatic' | 'interactive' }
export function brokerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Broker requires an HTTPS origin without credentials or a path.');
  return url.origin;
}
export class BrokerClient {
  constructor(private readonly identity: BrokerIdentity, private readonly doFetch: typeof fetch = fetch) { brokerUrl(identity.url); }
  private async request(route: string, body?: unknown, signal?: AbortSignal) {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(body === undefined ? 15_000 : 900_000);
      response = await this.doFetch(`${brokerUrl(this.identity.url)}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${this.identity.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([timeout, signal]) : timeout, redirect: 'error' });
    } catch { throw new Error('Broker unavailable. Administrator may need to wake the machine. Outcome may be uncertain; inspect before retrying.'); }
    const result = await response.json().catch(() => { throw new Error('Broker unavailable. Administrator may need to wake the machine.'); });
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Broker rejected the request.');
    return result;
  }
  status = (): Promise<BrokerStatus> => this.request('/status');
  async operation<T>(operation: string, args: Record<string, unknown>, manual = false): Promise<T> { return (await this.request('/operation', { operation, arguments: args, manual }, manual ? undefined : resolvedRun()?.signal)).result; }
  static async enroll(url: string, code: string, installationId: string, name: string): Promise<BrokerIdentity> {
    const origin = brokerUrl(url);
    let response: Response;
    try { response = await fetch(`${origin}/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, installationId, name }), redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Enrollment outcome unknown. Ask administrator before requesting another invite.'); }
    const result = await response.json();
    const parsed = z.object({ token: z.string().min(32).max(200), tenant: z.object({ id: z.uuid(), name: z.string().max(80) }) }).safeParse(result);
    if (!response.ok || !parsed.success) throw new Error('Enrollment rejected. Invite may have expired or already been used.');
    return { url: origin, token: parsed.data.token, tenantId: parsed.data.tenant.id, name: parsed.data.tenant.name };
  }
}
