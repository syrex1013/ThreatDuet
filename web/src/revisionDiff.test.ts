import { expect, it } from 'vitest';
import { revisionDiff } from './revisionDiff';

it('shows additions, removals and unchanged files without losing trailing newlines', () => {
  expect(revisionDiff('a\nb\nc\n', 'a\nx\nc\n')).toBe('  a\n- b\n+ x\n  c\n  ');
  expect(revisionDiff('a', 'a\nb')).toBe('  a\n+ b');
  expect(revisionDiff('a\nb', 'a')).toBe('  a\n- b');
  expect(revisionDiff('a', 'a')).toBe('No changes.');
});
