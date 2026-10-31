import os from 'node:os';
import { execa } from 'execa';

/** Commands from the proposal being carried out now. A command that isn't in it never runs. */
let approved: string[] | null = null;

/** Each fenced block counts as one command; so does any single line inside it. */
export function commandsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```(?:[a-zA-Z]+\n|\n)?([\s\S]*?)```/g)) {
    const block = m[1].trim();
    if (!block) continue;
    out.push(block, ...block.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return out;
}

export const hasCommands = (text: string) => commandsIn(text).length > 0;

export function allowCommands(text: string): void {
  approved = commandsIn(text);
}

export function clearCommands(): void {
  approved = null;
}

export async function runShell(command: string, cwd?: string, timeoutSeconds = 60): Promise<string> {
  if (!approved?.includes(command.trim()))
    throw new Error('This command is not in the proposal the user approved, so it was not run. Commands must appear exactly, each in its own ``` block, in the approved text.');
  const [bin, args] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]] : ['/bin/zsh', ['-c', command]];
  const r = await execa(bin as string, args as string[], { cwd: cwd ?? os.homedir(), timeout: timeoutSeconds * 1000, reject: false, all: true, stdin: 'ignore', maxBuffer: 5_000_000 });
  const out = (r.all ?? '').slice(-20_000);
  return `exit ${r.timedOut ? 'timed out' : r.exitCode}\n${out}`;
}
