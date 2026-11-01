import { randomUUID } from 'node:crypto';
import type { ExactCall, Receipt } from '../shared/types.js';
import { allowExactCommand, clearCommands } from './mac/shell.js';
import { db } from './store.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sameCall = (a: ExactCall, b: ExactCall) => a.tool === b.tool && canonical(a.arguments) === canonical(b.arguments);
export const permittedCall = (call: ExactCall) => db.data.permissions.some((p) => p.expiresAt > Date.now() && sameCall(p, call));

/** Persist intent before dispatch. A lost response must be reconciled, never retried silently. */
export async function recordCall(call: ExactCall, execute: () => Promise<string>, taskId?: string, proposalId?: string): Promise<string> {
  const previous = proposalId && db.data.receipts.find((r) => r.proposalId === proposalId && r.status === 'confirmed' && sameCall(r, call));
  if (previous) return previous.result;
  if (taskId && db.data.receipts.some((r) => r.taskId === taskId && ['running', 'uncertain'].includes(r.status))) throw new Error('Task has an unresolved action. Reconcile before any further writes.');
  if (db.data.receipts.some((r) => (r.status === 'uncertain' || r.status === 'running') && sameCall(r, call))) throw new Error('An identical action has an unresolved receipt. Reconcile it before retrying.');
  const receipt: Receipt = { ...call, id: randomUUID(), taskId, proposalId, startedAt: Date.now(), endedAt: null, status: 'running', result: '' };
  db.data.receipts.push(receipt);
  await db.write();
  try {
    if (call.tool === 'local_shell_run' && typeof call.arguments.command === 'string') allowExactCommand(call.arguments.command);
    const result = await execute();
    receipt.result = result.slice(0, 20_000);
    receipt.status = /^\s*$|^ERROR:|^exit (?!0\b)|\b(timed? out|pending confirmation|outcome unknown)\b/i.test(result) ? 'uncertain' : 'confirmed';
    return result;
  } catch (e) {
    receipt.status = 'uncertain';
    receipt.result = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    if (call.tool === 'local_shell_run') clearCommands();
    receipt.endedAt = Date.now();
    await db.write();
  }
}
