// sandbox="" alone still lets <img src=https://...> beacon file contents out; the CSP stops every fetch.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

/**
 * The page for a sandboxed HTML preview. <link rel=dns-prefetch> resolves names despite the CSP and
 * x-dns-prefetch-control, so no <link> tag may reach the parser; entities keep attribute text as it was.
 */
export const previewDoc = (html: string) => CSP + html.replace(/<link/gi, '&lt;link');
