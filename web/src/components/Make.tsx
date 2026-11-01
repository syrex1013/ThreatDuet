import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getFiles, request } from '../api';
import { clock, dayLabel } from '../lib';
import { Sheet } from './Sheet';
import { t } from '../i18n';

export function Make({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.set('file', file);
      const result = await request<{ path: string }>('/artifacts/upload', { method: 'POST', headers: { 'x-duet': '1' }, body: form });
      await qc.invalidateQueries({ queryKey: ['files'] });
      onOpen(result.path);
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  }
  const files = useQuery({ queryKey: ['files'], queryFn: getFiles });
  const groups: { label: string; items: NonNullable<typeof files.data>['files'] }[] = [];
  for (const f of files.data?.files ?? []) {
    const label = dayLabel(f.mtime);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(f);
    else groups.push({ label, items: [f] });
  }
  return (
    <Sheet title={t('Made by Duet')} onClose={onClose}>
      <div className="upload-zone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!uploading) void upload(e.dataTransfer.files[0]); }}><label>{t('Drop a document or screenshot here, or choose a file (10 MB maximum).')}<input type="file" disabled={uploading} onChange={(e) => void upload(e.target.files?.[0])} /></label></div>
      {error && <p className="is-error" role="alert">{error}</p>}
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
