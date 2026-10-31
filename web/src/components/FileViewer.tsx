import { useQuery } from '@tanstack/react-query';
import { getFile } from '../api';
import { Markdown } from './Markdown';
import { Sheet } from './Sheet';

export function FileViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const file = useQuery({ queryKey: ['file', path], queryFn: () => getFile(path), retry: false });
  return (
    <Sheet title={path} wide onClose={onClose}>
      {file.isPending && <p className="muted">Opening {path}…</p>}
      {file.error && <p className="is-error">{file.error.message}</p>}
      {file.data &&
        (/\.(md|markdown)$/i.test(path) ? (
          <Markdown text={file.data.text} />
        ) : (
          <pre className="file-raw">{file.data.text}</pre>
        ))}
      <p className="muted file-where">Saved in Duet's workspace folder as {path}.</p>
    </Sheet>
  );
}
