/** Preserve exact changed content; collapse only the common prefix and suffix. */
export function revisionDiff(before: string, after: string): string {
  if (before === after) return 'No changes.';
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  let end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [
    ...a.slice(Math.max(0, start - 2), start).map((line) => `  ${line}`),
    ...a.slice(start, a.length - end).map((line) => `- ${line}`),
    ...b.slice(start, b.length - end).map((line) => `+ ${line}`),
    ...a.slice(a.length - end, a.length - end + 2).map((line) => `  ${line}`),
  ].join('\n');
}
