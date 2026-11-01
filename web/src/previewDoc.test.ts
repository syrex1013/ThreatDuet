import { describe, expect, it } from 'vitest';
import { previewDoc } from './previewDoc';

describe('previewDoc', () => {
  it('puts the CSP first and lets no <link> tag through', () => {
    const doc = previewDoc('<p title="<link>">x</p><LiNk rel=dns-prefetch href=//a.example.com><svg><link/href=//b.example.com></svg>');
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    expect(doc).not.toMatch(/<link/i);
    expect(doc).toContain('title="&lt;link>"');
  });
});
