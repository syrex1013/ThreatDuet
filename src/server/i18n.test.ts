import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

let store: typeof import('./store.js');
let tr: typeof import('./i18n.js')['tr'];

beforeAll(async () => {
  // config.ts reads this at import time, so set it before loading any server module.
  process.env.OPENDUET_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'openduet-test-'));
  store = await import('./store.js');
  await store.openStore();
  tr = (await import('./i18n.js')).tr;
});

describe('tr', () => {
  it('speaks the language in the settings and fills placeholders', () => {
    expect(tr('reading {file}', { file: 'a.md' })).toBe('reading a.md');
    store.db.data.settings.language = 'pl';
    try {
      expect(tr('Duet needs your approval')).toBe('Duet czeka na Twoją zgodę');
      expect(tr('working on your task, step {step} of {max}', { step: 2, max: 6 })).toBe('pracuje nad Twoim zadaniem, krok 2 z 6');
      expect(tr('not in the dictionary {x}', { x: 1 })).toBe('not in the dictionary 1');
    } finally {
      store.db.data.settings.language = 'en';
    }
  });
});
