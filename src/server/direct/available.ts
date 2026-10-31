import { execa } from 'execa';
import { db } from '../store.js';

let haveKilo: Promise<boolean> | null = null;
/** Is the Kilo program installed? Checked once. Without it, Duet uses Kilo's hosted API directly. */
export function kiloInstalled(): Promise<boolean> {
  haveKilo ??= execa('kilo', ['--version'], { reject: false, timeout: 20_000, stdin: 'ignore' }).then((r) => r.exitCode === 0);
  return haveKilo;
}

/** True when tasks and apps run on Duet's own agent and Kilo's hosted API, not on the Kilo program. */
export async function useDirect(): Promise<boolean> {
  return db.data.settings.kiloMode === 'direct' || !(await kiloInstalled());
}
