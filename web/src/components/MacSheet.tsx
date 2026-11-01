import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { MacStatus, OsId } from '../../../src/shared/types';
import { post, request } from '../api';
import { t } from '../i18n';
import { LiveBrowser } from './LiveBrowser';
import { Sheet } from './Sheet';

/** Mac or PC, for the words the person reads: the computer Duet runs on, not the one showing this screen (a phone). */
export const deviceName = (os?: OsId) => ((os ? os === 'mac' : /Mac/i.test(navigator.platform)) ? 'Mac' : 'PC');

/** What Duet may reach on this Mac. Everything starts off; lives on the computer only. */
export function MacSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['mac'], queryFn: () => request<MacStatus>('/mac'), refetchOnWindowFocus: true });
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const act = useMutation({
    mutationFn: ([path, body]: [string, unknown]) => post<MacStatus>(path, body),
    onSuccess: (s) => {
      setError(null);
      qc.setQueryData(['mac'], s);
    },
    onError: (e) => setError(e.message),
  });
  const s = status.data;
  // Whole sentences per variant: Polish inflects the noun.
  const MAC = deviceName(s?.os) === 'Mac';
  const WIN = s?.os === 'windows';
  const set = (patch: Partial<Pick<MacStatus, 'files' | 'everything' | 'shell' | 'browser' | 'auto'>>) => act.mutate(['/mac', patch]);
  const add = (path: string) => act.mutate(['/mac/folders', { path }], { onSuccess: () => setFolder('') });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (folder.trim()) add(folder.trim());
  };

  return (
    <Sheet title={MAC ? t('Your Mac') : t('Your PC')} wide onClose={onClose}>
      <p className="apps-intro">
        {MAC
          ? t('Let Duet use this Mac. Everything is off until you turn it on. Duet looks on its own; anything that changes something waits for your approval.')
          : t('Let Duet use this PC. Everything is off until you turn it on. Duet looks on its own; anything that changes something waits for your approval.')}
      </p>
      {!s ? (
        <p className="muted">{status.error?.message ?? t('Checking…')}</p>
      ) : (
        <>
          {error && (
            <p className="is-error apps-error" role="alert">
              {error}
            </p>
          )}

          <section className="apps-section" aria-label={t('Files')}>
            <h3>{t('Files')}</h3>
            <label className="check">
              <input type="checkbox" checked={s.files} disabled={act.isPending} onChange={(e) => set({ files: e.target.checked })} />
              <span>
                {t('Let Duet read and search my files')}
                <span className="hint">
                  {WIN
                    ? t("Writing a file always waits for approval. Folders with passwords and keys (AppData credential stores, browser data, OpenDuet's own data) stay off-limits even inside a folder you add.")
                    : t("Writing a file always waits for approval. Folders with passwords and keys (~/.ssh, Keychains, browser data, OpenDuet's own data) stay off-limits even inside a folder you add.")}
                </span>
              </span>
            </label>
            {s.files && (
              <>
                <div className="tabs" role="radiogroup" aria-label={t('Where')}>
                  <button type="button" className={`btn btn-text btn-sm${s.everything ? '' : ' is-on'}`} role="radio" aria-checked={!s.everything} disabled={act.isPending} onClick={() => set({ everything: false })}>
                    {t('Folders I choose')}
                  </button>
                  <button type="button" className={`btn btn-text btn-sm${s.everything ? ' is-on' : ''}`} role="radio" aria-checked={s.everything} disabled={act.isPending} onClick={() => set({ everything: true })}>
                    {MAC ? t('Everything on this Mac') : t('Everything on this PC')}
                  </button>
                </div>
                {s.everything && (
                  <p className="hint">
                    {MAC
                      ? t('Duet can open any folder on this Mac that you can, except the credential stores above. Searches without a folder start in your home folder.')
                      : t('Duet can open any folder and drive on this PC that you can, except the credential stores above. Searches without a folder start in your user folder.')}
                  </p>
                )}
                {s.everything && s.fullDisk === false && (
                  <div className="reset">
                    <button type="button" className="btn btn-quiet btn-sm" disabled={act.isPending} onClick={() => act.mutate(['/mac/privacy', {}])}>
                      {t('Open Privacy & Security settings')}
                    </button>
                    <span className="hint">{t('macOS keeps Mail, Messages, Safari and backups closed until you add OpenDuet under Full Disk Access. Other folders ask the first time Duet opens them.')}</span>
                  </div>
                )}
                {!s.everything && (
                <ul className="apps-list">
                  {s.folders.map((f) => (
                    <li key={f} className="app-row">
                      <div className="app-main">
                        <div className="app-name">{f}</div>
                        <div className="app-controls">
                          <button type="button" className="btn btn-text btn-sm" onClick={() => act.mutate(['/mac/folders/remove', { path: f }])}>
                            {t('Remove')}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                  {s.folders.length === 0 && <li className="hint">{t("No folders yet. Duet can't see any file until you add one.")}</li>}
                </ul>
                )}
                {!s.everything && (
                <form className="market-search" onSubmit={submit}>
                  <label htmlFor="mac-folder" className="sr-only">
                    {t('Folder to add')}
                  </label>
                  <input id="mac-folder" spellCheck={false} placeholder={WIN ? 'C:\\Users\\you\\Documents' : '~/Documents'} value={folder} onChange={(e) => setFolder(e.target.value)} />
                  <button type="submit" className="btn btn-quiet btn-sm" disabled={!folder.trim() || act.isPending}>
                    {t('Add folder')}
                  </button>
                </form>
                )}
                {!s.everything && (
                <div className="tabs">
                  {['~/Documents', '~/Desktop', '~/Downloads'].map((p) => (
                    <button key={p} type="button" className="btn btn-text btn-sm" disabled={act.isPending} onClick={() => add(p)}>
                      {WIN ? p.replace('~/', '~\\') : p}
                    </button>
                  ))}
                </div>
                )}
                {!s.everything && MAC && <p className="hint">{t('The first time Duet opens Documents, Desktop or Downloads, macOS asks you to allow it.')}</p>}
              </>
            )}
          </section>

          <section className="apps-section" aria-label={t('Browser')}>
            <h3>{t('Browser')}</h3>
            <label className="check">
              <input type="checkbox" checked={s.browser} disabled={act.isPending || !s.browsers.some((b) => b.installed)} onChange={(e) => set({ browser: e.target.checked })} />
              <span>
                {t('Let Duet browse signed in as me')}
                <span className="hint">
                  {s.browsers.some((b) => b.installed)
                    ? t(
                        "Duet opens a browser out of sight with a copy of your sign-ins, so it can use Gmail, calendars and dashboards. The copy stays in OpenDuet's private folder and is deleted when you turn this off, switch browser or quit. Duet never sees the cookies themselves, only the pages. Reading a page is automatic; clicking, typing and submitting wait for approval, and happen as you.",
                      )
                    : t('Brave, Chrome or Firefox must be installed.')}
                </span>
              </span>
            </label>
            {s.browser && (
              <>
                <div className="field">
                  <label htmlFor="mac-browser">{t('Take sign-ins from')}</label>
                  <select id="mac-browser" value={s.browserApp} disabled={act.isPending} onChange={(e) => act.mutate(['/mac', { browserApp: e.target.value }])}>
                    <option value="auto">{t('Whichever is installed')}</option>
                    {s.browsers.map((b) => (
                      <option key={b.id} value={b.id} disabled={!b.installed}>
                        {b.installed ? b.name : t('{name} (not installed)', { name: b.name })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="reset">
                  <button type="button" className="btn btn-quiet btn-sm" disabled={act.isPending} onClick={() => act.mutate(['/mac/browser/refresh', {}])}>
                    {t('Copy my sign-ins again')}
                  </button>
                  <span className="hint">
                    {s.browserRunning ? t('Running for Duet now: {browser}.', { browser: s.browserRunning }) : t('Starts the next time Duet browses.')}{' '}
                    {t('Close the browser first if the copy fails, and use this after you sign in to something new.')}
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="apps-section" aria-label={t('Commands')}>
            <h3>{t('Commands')}</h3>
            <label className="check">
              <input type="checkbox" checked={s.shell} disabled={act.isPending} onChange={(e) => set({ shell: e.target.checked })} />
              <span>
                {WIN ? t('Let Duet propose PowerShell commands') : t('Let Duet propose shell commands')}
                <span className="hint">
                  {t('Every command is shown to you in full first, and only the exact commands you approve can run. From a paired phone this needs “Use fully from phone” under Settings → Phone.')}
                </span>
              </span>
            </label>
          </section>

          {s.browser && (
            <div className="mac-live-browser">
              <LiveBrowser source="local" wake={false} />
            </div>
          )}

          {(s.files || s.browser || s.shell) && (
            <section className="apps-section" aria-label={t('Auto mode')}>
              <h3>{t('Auto mode')}</h3>
              <label className="check">
                <input type="checkbox" checked={s.auto} disabled={act.isPending} onChange={(e) => set({ auto: e.target.checked })} />
                <span>
                  {MAC ? t('Let Duet act on this Mac without asking (allow all)') : t('Let Duet act on this PC without asking (allow all)')}
                  <span className="hint">
                    {t('Everything turned on above runs on its own: writing files, running commands, opening pages, clicking and typing as you. No proposal, no approval. Duet is still told not to delete, send or pay unasked, but nothing enforces it.')}
                  </span>
                </span>
              </label>
            </section>
          )}

          {(s.files || s.browser || s.shell) && (
            <p className="warning">
              <AlertTriangle size={14} aria-hidden="true" />{' '}
              {MAC
                ? t('With the Mac connected, text in a file, web page or email could try to steer Duet. Duet treats it as data and asks before it acts or sends anything, so read each proposal before you approve it.')
                : t('With the PC connected, text in a file, web page or email could try to steer Duet. Duet treats it as data and asks before it acts or sends anything, so read each proposal before you approve it.')}
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
