import os from 'node:os';
import { execa } from 'execa';
import { commandsIn, hasCommands, normalizeActions, normCommand } from '../../shared/actions.js';
import { db } from '../store.js';

export { commandsIn, hasCommands, normalizeActions };

/** Commands from the proposal being carried out now. A command that isn't in it never runs. */
let approved: string[] | null = null;

export function allowCommands(text: string): void {
  approved = commandsIn(normalizeActions(text));
}

export function allowExactCommand(command: string): void {
  approved = [command];
}

export function clearCommands(): void {
  approved = null;
}

/** Strip markdown fences if the model accidentally wraps the command in them. */
function unfence(command: string): string {
  const m = command.trim().match(/^```[^\n]*\n([\s\S]+?)\n```$/);
  return m ? m[1].trim() : command.trim();
}

export async function runShell(command: string, cwd?: string, timeoutSeconds = 60): Promise<string> {
  const candidate = unfence(command);
  // Find a matching approved command. Prefer exact match; fall back to quote/whitespace-normalized match.
  // Execute the approved text (what the user saw), not the model's regenerated version.
  const match = approved?.find((a) => a === candidate || a === command.trim() || normCommand(a) === normCommand(candidate));
  // Auto mode: the user chose to let Duet run commands without a proposal.
  if (!db.data.mac.auto && !match)
    throw new Error('This command is not in the proposal the user approved, so it was not run. Commands must appear exactly, each in its own ``` block, in the approved text.');
  const cmd = match ?? candidate;
  const [bin, args] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]] : [process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh', ['-c', cmd]];
  const r = await execa(bin as string, args as string[], { cwd: cwd ?? os.homedir(), timeout: timeoutSeconds * 1000, reject: false, all: true, stdin: 'ignore', maxBuffer: 5_000_000 });
  const out = (r.all ?? '').slice(-20_000);
  // No exit code: it never started (missing folder), or was killed (signal, output too large). Keep what it printed.
  if (r.failed && r.exitCode === undefined && !r.timedOut) return `exit failed\n${r.shortMessage}\n${out}`;
  return `exit ${r.timedOut ? 'timed out' : r.exitCode}\n${out}`;
}
