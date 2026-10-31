import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Duet writes markdown. Raw HTML is not rendered (react-markdown's default), so replies cannot inject markup,
 * and images are dropped because loading one would send a request nobody chose to make.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Images load on sight: a reply or file could carry data out in an image address.
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
