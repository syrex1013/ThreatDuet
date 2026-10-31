import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { MacStatus } from '../../../src/shared/types';
import { post, request } from '../api';
import { Sheet } from './Sheet';

/** "Mac" or "PC", for the words the person reads. */
const PC = /Mac/i.test(navigator.platform) ? 'Mac' : 'PC';

/** What Duet may reach on this Mac. Everything starts off; lives on the computer only. */
export function MacSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['mac'], queryFn: () => request<MacStatus>('/mac') });
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
  const set = (patch: Partial<Pick<MacStatus, 'files' | 'shell' | 'browser'>>) => act.mutate(['/mac', patch]);
  const add = (path: string) => act.mutate(['/mac/folders', { path }], { onSuccess: () => setFolder('') });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (folder.trim()) add(folder.trim());
  };

  return (
    <Sheet title={`Your ${PC}`} wide onClose={onClose}>
      <p className="apps-intro">
        Let Duet use this {PC}. Everything is off until you turn it on. Duet looks on its own; anything that changes something waits for your approval.
      </p>
      {!s ? (
        <p className="muted">{status.error?.message ?? 'Checking…'}</p>
      ) : (
        <>
          {error && (
            <p className="is-error apps-error" role="alert">
              {error}
            </p>
          )}

          <section className="apps-section" aria-label="Files">
            <h3>Files</h3>
            <label className="check">
              <input type="checkbox" checked={s.files} disabled={act.isPending} onChange={(e) => set({ files: e.target.checked })} />
              <span>
                Let Duet read and search files in folders I choose
                <span className="hint">Writing a file always waits for approval. Folders with passwords and keys (~/.ssh, Keychains, browser data, OpenDuet's own data) stay off-limits even inside a folder you add.</span>
              </span>
            </label>
            {s.files && (
              <>
                <ul className="apps-list">
                  {s.folders.map((f) => (
                    <li key={f} className="app-row">
                      <div className="app-main">
                        <div className="app-name">{f}</div>
                        <div className="app-controls">
                          <button type="button" className="btn btn-text btn-sm" onClick={() => act.mutate(['/mac/folders/remove', { path: f }])}>
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                  {s.folders.length === 0 && <li className="hint">No folders yet. Duet can't see any file until you add one.</li>}
                </ul>
                <form className="market-search" onSubmit={submit}>
                  <label htmlFor="mac-folder" className="sr-only">
                    Folder to add
                  </label>
                  <input id="mac-folder" spellCheck={false} placeholder="~/Documents" value={folder} onChange={(e) => setFolder(e.target.value)} />
                  <button type="submit" className="btn btn-quiet btn-sm" disabled={!folder.trim() || act.isPending}>
                    Add folder
                  </button>
                </form>
                <div className="tabs">
                  {['~/Documents', '~/Desktop', '~/Downloads'].map((p) => (
                    <button key={p} type="button" className="btn btn-text btn-sm" disabled={act.isPending} onClick={() => add(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="apps-section" aria-label="Browser">
            <h3>Browser</h3>
            <label className="check">
              <input type="checkbox" checked={s.browser} disabled={act.isPending || !s.browsers.some((b) => b.installed)} onChange={(e) => set({ browser: e.target.checked })} />
              <span>
                Let Duet browse signed in as me
                <span className="hint">
                  {s.browsers.some((b) => b.installed)
                    ? "Duet opens a browser out of sight with a copy of your sign-ins, so it can use Gmail, calendars and dashboards. The copy stays in OpenDuet's private folder and is deleted when you turn this off, switch browser or quit. Duet never sees the cookies themselves, only the pages. Reading a page is automatic; clicking, typing and submitting wait for approval, and happen as you."
                    : 'Brave, Chrome or Firefox must be installed.'}
                </span>
              </span>
            </label>
            {s.browser && (
              <>
                <div className="field">
                  <label htmlFor="mac-browser">Take sign-ins from</label>
                  <select id="mac-browser" value={s.browserApp} disabled={act.isPending} onChange={(e) => act.mutate(['/mac', { browserApp: e.target.value }])}>
                    <option value="auto">Whichever is installed</option>
                    {s.browsers.map((b) => (
                      <option key={b.id} value={b.id} disabled={!b.installed}>
                        {b.name}
                        {b.installed ? '' : ' (not installed)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="reset">
                  <button type="button" className="btn btn-quiet btn-sm" disabled={act.isPending} onClick={() => act.mutate(['/mac/browser/refresh', {}])}>
                    Copy my sign-ins again
                  </button>
                  <span className="hint">{s.browserRunning ? `Running for Duet now: ${s.browserRunning}.` : 'Starts the next time Duet browses.'} Close the browser first if the copy fails, and use this after you sign in to something new.</span>
                </div>
              </>
            )}
          </section>

          <section className="apps-section" aria-label="Commands">
            <h3>Commands</h3>
            <label className="check">
              <input type="checkbox" checked={s.shell} disabled={act.isPending} onChange={(e) => set({ shell: e.target.checked })} />
              <span>
                Let Duet propose shell commands
                <span className="hint">Every command is shown to you in full first, and only the exact commands you approve can run. Commands can only be approved on this computer, never from a paired phone.</span>
              </span>
            </label>
          </section>

          {(s.files || s.browser || s.shell) && (
            <p className="warning">
              <AlertTriangle size={14} aria-hidden="true" /> With the {PC} connected, text in a file, web page or email could try to steer Duet. Duet treats it as data and asks before it acts or sends anything, so read each proposal before you approve it.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
