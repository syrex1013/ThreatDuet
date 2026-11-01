import os from 'node:os';
import { execa } from 'execa';
import { db } from '../store.js';

/** Commands from the proposal being carried out now. A command that isn't in it never runs. */
let approved: string[] | null = null;

/**
 * Each fenced block counts as one command; so does any single line inside it. Only fences with nothing but
 * indentation before them count (as in the markdown the person reads, including blocks nested under a list
 * item), so text can't smuggle a command in through an inline fence.
 */
export function commandsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^([ \t]*)```[^\n`]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
    const indent = m[1];
    const block = m[2]
      .split('\n')
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
      .join('\n')
      .trim();
    if (!block) continue;
    out.push(block, ...block.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return out;
}

/** Any fence at all counts, so a proposal with something command-like is never approved from a phone. */
export const hasCommands = (text: string) => text.includes('```') || commandsIn(text).length > 0;

export function allowCommands(text: string): void {
  approved = commandsIn(text);
}

export function clearCommands(): void {
  approved = null;
}

/** Strip markdown fences if the model accidentally wraps the command in them. */
function unfence(command: string): string {
  const m = command.trim().match(/^```[^\n]*\n([\s\S]+?)\n```$/);
  return m ? m[1].trim() : command.trim();
}

/**
 * Normalize for fuzzy matching only — never use the result as the command to run.
 * Maps Unicode curly quotes to ASCII and collapses runs of whitespace.
 */
function norm(s: string): string {
  return s
    .trim()
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/\s+/g, ' ');
}

export async function runShell(command: string, cwd?: string, timeoutSeconds = 60): Promise<string> {
  const candidate = unfence(command);
  // Find a matching approved command. Prefer exact match; fall back to quote/whitespace-normalized match.
  // Execute the approved text (what the user saw), not the model's regenerated version.
  const match = approved?.find((a) => a === candidate || a === command.trim() || norm(a) === norm(candidate));
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
