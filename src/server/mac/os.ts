/** What the user's own computer is called, in text for Duet and in messages: not every one is a Mac. */
export const OS_NAME = process.platform === 'win32' ? 'Windows PC' : process.platform === 'darwin' ? 'Mac' : 'Linux computer';

/** The panel where the user switches this computer's access on and off. */
export const OS_PANEL = process.platform === 'darwin' ? 'Your Mac' : 'Your PC';

/** Told to Duet on every turn, so it never proposes another system's tools, paths or commands. */
export const osLine = () =>
  process.platform === 'win32'
    ? "The user's own computer runs Windows. Commands there run in Windows PowerShell; paths look like C:\\Users\\<name>\\Documents; use Windows apps and tools (File Explorer, Outlook, winget). Never suggest macOS or Linux tools (Finder, Spotlight, Homebrew, zsh, AppleScript, apt)."
    : process.platform === 'darwin'
      ? "The user's own computer is a Mac (macOS). Commands there run in zsh; paths look like /Users/<name>/Documents."
      : "The user's own computer runs Linux. Commands there run in sh; paths look like /home/<name>/Documents.";
