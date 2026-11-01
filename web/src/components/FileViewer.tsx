import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getFile } from '../api';
import { previewDoc } from '../previewDoc';
import { Markdown } from './Markdown';
import { Sheet } from './Sheet';
import { t } from '../i18n';

const BINARY = /\.(xlsx?|pptx?|docx?|key|numbers|pages|pdf|png|jpe?g|gif|webp|heic|zip|mp[34]|mov)$/i;

export function FileViewer({ path, onClose, onAsk }: { path: string; onClose: () => void; onAsk: (text: string) => void }) {
  const binary = BINARY.test(path);
  const html = /\.html?$/i.test(path);
  const file = useQuery({ queryKey: ['file', path], queryFn: () => getFile(path), retry: false, enabled: !binary });
  const [source, setSource] = useState(false);
  const [selection, setSelection] = useState('');
  const [ask, setAsk] = useState('');
  const view = useRef<HTMLDivElement>(null);

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
