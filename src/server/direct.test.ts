import { describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.OPENDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/openduet-direct-`);
});

describe("built-in agent rules and gateway", () => {
  it('obeys the same permission file as Kilo', async () => {
    const store = await import('./store.js');
    await store.openStore();
    const settings = await import('./mac/settings.js');
    await settings.setMac({ files: true, shell: true });
    const { policyFor } = await import('./direct/permit.js');
    const duet = await policyFor('duet', false);
    for (const t of ['read', 'list', 'glob', 'grep', 'skill', 'mac_files_read', 'mac_browser_read']) expect(duet.tool(t), t).toBe('allow');
    for (const t of ['bash', 'mac_shell_run', 'mac_files_write', 'mac_browser_click', 'webfetch', 'made_up_tool']) expect(duet.tool(t), t).toBe('deny');
    expect(duet.tool('write')).toBe('allow');
    expect(duet.edit('notes.md')).toBe('allow');
    for (const f of ['kilo.json', 'AGENTS.md', '.kilo/skills/x/SKILL.md', 'sub/kilo.json']) expect(duet.edit(f), f).toBe('deny');
    const code = await policyFor('code', true);
    expect(code.tool('mac_shell_run')).toBe('allow');
    expect(code.tool('bash')).toBe('deny');
    expect(code.edit('kilo.json')).toBe('deny');
  });

  it('names models the way the gateway expects', async () => {
    const { gatewayModel } = await import('./direct/gateway.js');
    expect(gatewayModel('kilo/kilo-auto/free')).toBe('kilo-auto/free');
    expect(gatewayModel('anthropic/claude')).toBe('anthropic/claude');
  });
});
