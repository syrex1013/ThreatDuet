/**
 * The page for a sandboxed HTML preview, as a static document. The CSP stops fetches but not navigation,
 * so a link or refresh in a file Duet wrote could still carry data to another site: every element and
 * attribute that can hold a URL or load something is dropped, using the browser's own parser.
 * <link rel=dns-prefetch> resolves names despite the CSP, so <link> goes too.
 * Self-contained on purpose: the test runs it in a real browser.
 */
export function previewDoc(html: string): string {
  // sandbox="" alone still lets <img src=https://...> beacon file contents out; the CSP stops every fetch.
  const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
  const DROP = 'script,link,meta,base,iframe,frame,frameset,object,embed,form,portal,noscript,template,set,animate,animateMotion,animateTransform,use,image,feImage';
  const URL_ATTR = /^(on|formaction$|action$|src|srcset$|poster$|background$|data$|ping$|manifest$|cite$|longdesc$|usemap$|lowsrc$|dynsrc$|codebase$|archive$|profile$|attributename$)|href$/i;
  const clean = (s: string) => {
    const doc = new DOMParser().parseFromString(s, 'text/html');
    doc.querySelectorAll(DROP).forEach((el) => el.remove());
    for (const el of Array.from(doc.querySelectorAll('*')))
      for (const a of Array.from(el.attributes)) if (URL_ATTR.test(a.localName) || URL_ATTR.test(a.name)) el.removeAttribute(a.name);
    return doc.documentElement.outerHTML;
  };
  const once = clean(html);
  // Re-parsing must not bring anything back; if it does, show nothing rather than guess.
  return CSP + (clean(once) === once ? once : '<p>This file can only be shown as source.</p>');
}
