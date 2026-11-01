import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type { OsId } from '../../shared/types.js';

export const OS_ID: OsId = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';

/** What the user's own computer is called, in text for Duet and in messages: not every one is a Mac. */
export const OS_NAME = process.platform === 'win32' ? 'Windows PC' : process.platform === 'darwin' ? 'Mac' : 'Linux computer';

/** The panel where the user switches this computer's access on and off. */
export const OS_PANEL = process.platform === 'darwin' ? 'Your Mac' : 'Your PC';

/** Told to Duet on every turn, so it never proposes another system's tools, paths or commands. */
export const osLine = () => {
  const rule =
    process.platform === 'win32'
      ? "The user's own computer runs Windows. Commands there run in Windows PowerShell; use Windows apps and tools (File Explorer, Outlook, winget). Never suggest macOS or Linux tools (Finder, Spotlight, Homebrew, zsh, AppleScript, apt)."
      : process.platform === 'darwin'
        ? "The user's own computer is a Mac (macOS). Commands there run in zsh. Never suggest Windows tools (PowerShell, File Explorer, winget)."
        : "The user's own computer runs Linux. Commands there run in sh.";
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
  const facts = [
    `OS: ${OS_NAME}, ${os.type()} ${os.release()} (${os.arch()})`,
    `user: ${os.userInfo().username}`,
    `home: ${os.homedir()}`,
    `shell: ${shell}`,
    `path separator: ${path.sep}`,
    `PATH: ${process.env.PATH ?? process.env.Path ?? ''}`,
    `locale/time zone: ${Intl.DateTimeFormat().resolvedOptions().locale}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ];
  return `${rule} Facts about it (use these exact paths and tools): ${facts.join('; ')}.`;
};

/**
 * macOS only: whether this app has Full Disk Access. Without it, macOS keeps Mail, Messages, Safari and
 * Time Machine data closed even when "everything" is on; the user grants it in System Settings.
 * shortcut: judged by one TCC-protected folder, upgrade to a native check if Apple moves it.
 */
export async function fullDiskAccess(): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null;
  return fs.readdir(path.join(os.homedir(), 'Library', 'Application Support', 'com.apple.TCC')).then(() => true, () => false);
}

/** Opens the OS page where the user grants the app access to the whole disk. Windows and Linux need no grant. */
export async function openPrivacySettings(): Promise<void> {
  if (process.platform === 'darwin') await execa('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'], { reject: false });
}
