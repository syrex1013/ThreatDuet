import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ArtifactRevision } from '../../../src/shared/types';
import { revisionDiff } from '../revisionDiff';
import { downloadFile, fileBlob, getFile, post, request } from '../api';
import { previewDoc } from '../previewDoc';
import { Markdown } from './Markdown';
import { Sheet } from './Sheet';
import { t } from '../i18n';

const BINARY = /\.(xlsx?|pptx?|docx?|key|numbers|pages|pdf|png|jpe?g|gif|webp|heic|zip|mp[34]|mov)$/i;

export function FileViewer({ path, onClose, onAsk }: { path: string; onClose: () => void; onAsk: (text: string) => void }) {
  const qc = useQueryClient();
  const [revisionId, setRevisionId] = useState('');
  const [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [restoring, setRestoring] = useState(false);
  const revisions = useQuery({ queryKey: ['revisions', path], queryFn: () => request<{ revisions: ArtifactRevision[] }>(`/artifacts/revisions?path=${encodeURIComponent(path)}`) });
  const revision = useQuery({ queryKey: ['revision', revisionId], queryFn: () => request<{ text: string }>(`/artifacts/revision?id=${encodeURIComponent(revisionId)}`), enabled: Boolean(revisionId) });
  const binary = BINARY.test(path);
  const html = /\.html?$/i.test(path);
  const file = useQuery({ queryKey: ['file', path], queryFn: () => getFile(path), retry: false, enabled: !binary });
  const [source, setSource] = useState(false);
  const [selection, setSelection] = useState('');
  const [ask, setAsk] = useState('');
  const view = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) return;
    let active = true;
    let url = '';
    void fileBlob(path).then((blob) => { url = URL.createObjectURL(blob); if (active) setImageUrl(url); else URL.revokeObjectURL(url); }, (e) => { if (active) setError(e.message); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);

  async function restore() {
    setRestoring(true); setError('');
    try {
      await post('/artifacts/restore', { id: revisionId });
      await Promise.all([qc.invalidateQueries({ queryKey: ['file', path] }), qc.invalidateQueries({ queryKey: ['revisions', path] })]);
      setRevisionId('');
    } catch (e) { setError((e as Error).message); }
    finally { setRestoring(false); }
  }

  // Focusing the input moves the page selection, so remember the last one made inside the viewer.
  useEffect(() => {
    const keep = () => {
      const sel = window.getSelection();
      if (sel && view.current?.contains(sel.anchorNode)) setSelection(sel.toString().trim());
    };
    document.addEventListener('selectionchange', keep);
    return () => document.removeEventListener('selectionchange', keep);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const instruction = ask.trim();
    if (!instruction) return;
    onAsk(
      selection
        ? t('In {path}, change only this part:', { path }) + `\n> ${selection.replace(/\n/g, '\n> ')}\n\n${instruction}`
        : t('In {path}: {instruction}', { path, instruction }),
    );
    onClose();
  };

  return (
    <Sheet title={path} wide onClose={onClose}>
      <button className="btn btn-quiet btn-sm" onClick={() => void downloadFile(path).catch((e) => setError(e.message))}>{t('Download')}</button>
      {(error || revisions.error || revision.error) && <p role="alert" className="is-error">{error || revisions.error?.message || revision.error?.message}</p>}
      {revisions.data && <label className="work-field"><span>{t('Revision history')}</span><select aria-label={t('Revision history')} value={revisionId} onChange={(e) => setRevisionId(e.target.value)}><option value="">{t('Current file')}</option>{[...revisions.data.revisions].reverse().map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.source}</option>)}</select></label>}
      {revisionId && <><button className="btn btn-quiet btn-sm" disabled={restoring} onClick={() => void restore()}>{t('Restore selected revision')}</button>{revision.data && file.data && <details open><summary>{t('Selected revision compared with current file')}</summary><pre className="revision-diff">{revisionDiff(revision.data.text, file.data.text)}</pre></details>}</>}
      {imageUrl && <img src={imageUrl} alt={path} style={{ maxWidth: '100%' }} />}
      <div ref={view}>
        {binary && <p className="muted">{t("This file can't be previewed here. Open it from the workspace folder.")}</p>}
        {file.isPending && !binary && <p className="muted">{t('Opening {path}…', { path })}</p>}
        {file.error && <p className="is-error">{file.error.message}</p>}
        {file.data && html && (
          <button type="button" className="btn btn-quiet btn-sm file-toggle" onClick={() => setSource(!source)}>
            {source ? t('Preview') : t('Source')}
          </button>
        )}
        {file.data &&
          (html && !source ? (
            <iframe className="file-frame" title={t('Preview of {path}', { path })} sandbox="" srcDoc={previewDoc(file.data.text)} />
          ) : /\.(md|markdown)$/i.test(path) ? (
            <Markdown text={file.data.text} />
          ) : (
            <pre className="file-raw">{file.data.text}</pre>
          ))}
      </div>
      {file.data && (
        <form className="file-ask" onSubmit={submit}>
          <label htmlFor="file-ask">{selection ? t('Ask Duet to change the selected part') : t('Ask Duet to change this')}</label>
          <input id="file-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={selection ? `“${selection.slice(0, 60)}”` : t('Select text first to change only that part')} />
        </form>
      )}
      <p className="muted file-where">{t("Saved in Duet's workspace folder as {path}.", { path })}</p>
    </Sheet>
  );
}
