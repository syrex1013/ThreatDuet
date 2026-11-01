import { useQuery } from '@tanstack/react-query';
import { getFiles } from '../api';
import { clock, dayLabel } from '../lib';
import { Sheet } from './Sheet';
import { t } from '../i18n';

export function Make({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const files = useQuery({ queryKey: ['files'], queryFn: getFiles });
  const groups: { label: string; items: NonNullable<typeof files.data>['files'] }[] = [];
  for (const f of files.data?.files ?? []) {
    const label = dayLabel(f.mtime);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(f);
    else groups.push({ label, items: [f] });
  }
  return (
    <Sheet title={t('Made by Duet')} onClose={onClose}>
      {files.isPending && <p className="muted">{t('Looking in the workspace…')}</p>}
      {files.error && <p className="is-error">{files.error.message}</p>}
      {files.data && !files.data.files.length && <p className="muted">{t('Nothing yet. Files Duet writes in its workspace show up here.')}</p>}
      {groups.map((g) => (
        <section key={g.label} className="apps-section">
          <h3>{g.label}</h3>
          <ul className="apps-list">
            {g.items.map((f) => (
              <li key={f.path}>
                <button type="button" className="make-file" onClick={() => onOpen(f.path)}>
                  <span>{f.path}</span>
                  <span className="muted">
                    {clock(f.mtime)} · {Math.max(1, Math.round(f.size / 1024))} KB
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
