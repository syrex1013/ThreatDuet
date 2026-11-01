import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, session, shell, Tray, type Rectangle } from 'electron';
import { execa } from 'execa';
import fixPath from 'fix-path';

// Apps opened from the Dock or Finder get a minimal PATH; kilo and git live in the user's shell PATH.
fixPath();

const isMac = process.platform === 'darwin';
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let origin = '';
let quitting = false;

// Size and place of the window, kept between launches. `full` is where the large window returns to from compact.
interface WindowState {
  full?: Rectangle;
  mini?: Rectangle;
  compact?: boolean;
}
const COMPACT = { width: 440, height: 680 };
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
let winState: WindowState = {};
const onScreen = (b?: Rectangle) =>
  b && screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y) ? b : undefined;

function loadWindowState() {
  try {
    winState = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as WindowState;
  } catch {
    winState = {};
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.isMinimized() || win.isFullScreen() ? undefined : win.getNormalBounds();
  if (b) winState[winState.compact ? 'mini' : 'full'] = b;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(winState));
  } catch {
    /* keeping the layout is a nicety */
  }
}

/** First compact window: the bottom-right corner of the screen the window is on. */
function cornerBounds(near: Rectangle): Rectangle {
  const w = screen.getDisplayMatching(near).workArea;
  return { ...COMPACT, x: w.x + w.width - COMPACT.width - 16, y: w.y + w.height - COMPACT.height - 16 };
}

function setCompact(compact: boolean) {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  saveWindowState();
  winState.compact = compact;
  const target = compact ? onScreen(winState.mini) ?? cornerBounds(win.getBounds()) : onScreen(winState.full);
  if (win.isMaximized()) win.unmaximize();
  if (target) win.setBounds(target, true);
  else win.setSize(1320, 880, true);
  win.setAlwaysOnTop(compact, 'floating');
  win.webContents.send('compact', compact);
  saveWindowState();
  tray?.setContextMenu(trayMenu?.() ?? null);
}
let trayMenu: (() => Menu) | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => (quitting = true));
  // Duet keeps working with no window open; quit from the tray or the app menu.
  app.on('window-all-closed', () => {});
  app.whenReady().then(boot).catch(fatal);
}

async function boot() {
  // config.ts reads these at import time, so they must be set before the server modules load.
  process.env.OPENDUET_HOME ??= app.getPath('userData');
  process.env.OPENDUET_WEB_DIST ??= path.join(app.getAppPath(), 'web', 'dist');
  const { startServer } = await import('../server/server.js');
  const { setNotifier } = await import('../server/notify.js');
  const { routines } = await import('../server/duet.js');
  // Keep the namespace: `db` is assigned when the server starts, and destructuring would copy `undefined`.
  const store = await import('../server/store.js');
  const { WORKSPACE } = await import('../server/config.js');

  const server = await startServer({ port: 0 });
  origin = `http://127.0.0.1:${server.port}`;
  let closing = false;
  app.on('will-quit', (e) => {
    e.preventDefault();
    if (closing) return;
    closing = true;
    void server.close().finally(() => app.exit(0));
  });

  setNotifier((title, body) => {
    const n = new Notification({ title, body });
    n.on('click', showWindow);
    n.show();
  });

  // The UI never needs camera, microphone, location and the like.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  loadWindowState();
  ipcMain.on('compact:toggle', (e) => {
    if (e.sender === win?.webContents) setCompact(!winState.compact);
  });
  ipcMain.on('compact:get', (e) => {
    if (e.sender === win?.webContents) e.sender.send('compact', Boolean(winState.compact));
  });
  app.on('before-quit', saveWindowState);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : [{ role: 'fileMenu' as const }]),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Compact window', accelerator: 'CmdOrCtrl+Shift+M', click: () => setCompact(!winState.compact) },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();

  const pending = () => store.db.data.messages.filter((m) => m.proposal?.status === 'pending').length;
  const menu = () =>
    Menu.buildFromTemplate([
      { label: pending() ? `${pending()} waiting for your approval` : 'Nothing needs you right now', enabled: false },
      { type: 'separator' },
      { label: 'Open OpenDuet', click: showWindow },
      {
        label: 'Compact window',
        type: 'checkbox',
        checked: Boolean(winState.compact),
        click: (item) => {
          showWindow();
          setCompact(item.checked);
        },
      },
      { label: 'Brief me now', click: () => routines.brief() },
      { label: 'Check in now', click: () => routines.check() },
      { type: 'separator' },
      {
        label: 'Open at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { label: 'Show workspace folder', click: () => void shell.openPath(WORKSPACE) },
      { type: 'separator' },
      { label: 'Quit OpenDuet', click: () => app.quit() },
    ]);
  trayMenu = menu;

  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', isMac ? 'trayTemplate.png' : 'icon.png'));
  tray = new Tray(isMac ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('OpenDuet');
  tray.setContextMenu(menu());

  // Approvals waiting: Dock badge, menu-bar count and tray menu stay in step with the thread.
  let shown = -1;
  setInterval(() => {
    const n = pending();
    if (n === shown) return;
    shown = n;
    app.setBadgeCount(n);
    if (isMac) tray?.setTitle(n ? ` ${n}` : '');
    tray?.setContextMenu(menu());
  }, 3000);

  await checkKilo();
}

function createWindow() {
  const start = winState.compact ? onScreen(winState.mini) ?? cornerBounds(screen.getPrimaryDisplay().bounds) : onScreen(winState.full);
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    ...start,
    minWidth: 360,
    minHeight: 480,
    resizable: true,
    movable: true,
    title: 'OpenDuet',
    backgroundColor: '#f4f4f4',
    show: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 24 } } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      preload: path.join(import.meta.dirname, 'preload.cjs'),
    },
  });
  if (winState.compact) win.setAlwaysOnTop(true, 'floating');
  // Started at login: stay in the tray until the user opens the window.
  const hidden = process.argv.includes('--hidden') || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  win.once('ready-to-show', () => !hidden && win?.show());
  void win.loadURL(`${origin}/?shell=${isMac ? 'mac' : 'desktop'}`);

  // Links in Duet's replies open in the default browser; the window itself never leaves the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A file preview (srcdoc frame) must never leave the app either.
  win.webContents.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && e.url !== 'about:srcdoc' && !e.url.startsWith(origin)) e.preventDefault();
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(origin)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  win.webContents.on('did-fail-load', (_e, code, description, url) =>
    console.error(`OpenDuet window failed to load ${url}: ${description} (${code})`),
  );
  win.webContents.on('render-process-gone', (_e, details) => console.error(`OpenDuet window crashed: ${details.reason}`));

  // Closing the window hides it; Duet keeps working in the background.
  win.on('close', (e) => {
    saveWindowState();
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });

  const shot = process.env.OPENDUET_SMOKE_SCREENSHOT;
  if (shot)
    win.webContents.once('did-finish-load', () => {
      console.log('smoke: window loaded');
      setTimeout(async () => {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(shot, (await win!.webContents.capturePage()).toPNG());
        console.log('smoke: screenshot written');
        app.quit();
      }, 2500);
    });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function checkKilo() {
  const r = await execa('kilo', ['--version'], { reject: false, timeout: 20_000, stdin: 'ignore' });
  if (r.exitCode === 0) return;
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'OpenDuet needs the Kilo CLI',
    detail:
      'Duet does its work through Kilo. Install it with "npm install -g @kilocode/cli", sign in with "kilo auth", then restart OpenDuet.',
    buttons: ['Continue', 'Open Kilo docs', 'Quit'],
    defaultId: 1,
  });
  if (response === 1) void shell.openExternal('https://kilo.ai/docs');
  if (response === 2) app.quit();
}

function fatal(err: unknown) {
  console.error('OpenDuet could not start:', err);
  if (!process.env.OPENDUET_SMOKE_SCREENSHOT) dialog.showErrorBox('OpenDuet could not start', err instanceof Error ? err.message : String(err));
  app.exit(1);
}
