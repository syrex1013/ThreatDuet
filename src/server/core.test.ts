import { describe, expect, it } from 'vitest';
import { parseKiloEvents, parseReply } from './parse.js';
import { consent, guard, inQuiet } from './policy.js';

describe('parseReply', () => {
  it('extracts actions and memory', () => {
    const r = parseReply('Drafted.\n<<REMEMBER: prefers short emails>>\n<<ACTIONS\n- send email to bob\nACTIONS>>');
    expect(r).toMatchObject({ text: 'Drafted.', actions: '- send email to bob', remember: ['prefers short emails'], continue: false });
  });
  it('reads tasks Duet starts and ones it suggests, and drops untitled ones', () => {
    const r = parseReply('Ok.\n<<TASK: Prep brief | read the thread>>\n<<SUGGEST: Tidy inbox | archive old mail>>\n<<TASK:  | nothing>>');
    expect(r.text).toBe('Ok.');
    expect(r.tasks).toEqual([
      { title: 'Prep brief', details: 'read the thread', start: true },
      { title: 'Tidy inbox', details: 'archive old mail', start: false },
    ]);
    expect(parseReply('1. `<<TASK: Offer template>>` — I will draft it').tasks).toEqual([{ title: 'Offer template', details: '', start: true }]);
    expect(parseReply('1. `<<TASK: Offer template>>` — I will draft it').text).toBe('1.  — I will draft it');
  });
  it('treats an unclosed block as a proposal', () => {
    expect(parseReply('ok <<ACTIONS\n- delete x').actions).toBe('- delete x');
  });
  it('reads continue, follow-ups and priority', () => {
    const now = Date.parse('2026-11-01T08:00:00');
    const r = parseReply(
      'Working on it.\n<<FOLLOWUP: 2026-11-02T09:00 | check if Bob replied>>\n<<FOLLOWUP: 2020-01-01T00:00 | stale>>\n<<FOLLOWUP: soon | bad>>\n<<PRIORITY: High>>\n<<CONTINUE>>',
      now,
    );
    expect(r.text).toBe('Working on it.');
    expect(r.continue).toBe(true);
    expect(r.priority).toBe('high');
    expect(r.followups).toEqual([{ at: Date.parse('2026-11-02T09:00'), what: 'check if Bob replied' }]);
  });

  it('normalizes glued list fences and drops duplicate commands', () => {
    const r = parseReply('Ok.\n<<ACTIONS\n- ```bash\nls a\n```\n- ```bash\nls a\n```\nACTIONS>>');
    expect(r.actions).toBe('```bash\nls a\n```');
  });

  it('keeps the last of several ACTIONS blocks and strips them all', () => {
    const r = parseReply('Plan <<ACTIONS\n- open x\nACTIONS>> then <<ACTIONS\n- open x\n- click accept\nACTIONS>> done');
    expect(r.actions).toBe('- open x\n- click accept');
    expect(r.text).toBe('Plan  then  done');
    expect(parseReply('<<ACTIONS\n- send\nACTIONS>> later <<ACTIONS\nnone\nACTIONS>>').actions).toBeNull();
  });
  it('reads a date-only follow-up as 09:00 local time', () => {
    const r = parseReply('<<FOLLOWUP: 2026-11-03 | check>>', Date.parse('2026-11-01T08:00:00'));
    expect(r.followups).toEqual([{ at: new Date(2026, 10, 3, 9, 0).getTime(), what: 'check' }]);
  });
  it('reads routine suggestions and drops invalid or sub-hourly patterns', () => {
    const r = parseReply('Ok.<<ROUTINE: 30 5 * * 1-5 | refresh x>>');
    expect(r.routines).toEqual([{ cron: '30 5 * * 1-5', what: 'refresh x' }]);
    expect(r.text).toBe('Ok.');
    for (const bad of ['99 99 * * *', '*/30 * * * *', '0,30 9 * * *', '* * * * *', '0 * * * * *', '0 0 30 2 *'])
      expect(parseReply(`<<ROUTINE: ${bad} | x>>`)).toMatchObject({ routines: [], text: '' });
    expect(parseReply('<<ROUTINE: 0 * * * * | hourly>>').routines).toHaveLength(1);
  });
  it('ignores empty or NONE blocks', () => {
    expect(parseReply('hi <<ACTIONS\nnone\nACTIONS>>').actions).toBeNull();
    expect(parseReply('just text').actions).toBeNull();
  });
});

describe('guard', () => {
  it('blocks off-limits actions', () => {
    expect(guard('- Buy 10 shares of AAPL')).toMatch(/trading/);
    expect(guard('- Transfer the money from savings to checking account')).toMatch(/moving money/);
  });
  it('blocks card numbers (Luhn) and SSNs', () => {
    expect(guard('card 4111 1111 1111 1111')).toMatch(/card/);
    expect(guard('ssn 123-45-6789')).toMatch(/SSN/);
  });
  it('allows ordinary actions and non-Luhn digit runs', () => {
    expect(guard('- Send reminder email for invoice 1234567890123')).toBeNull();
    expect(guard('- Reschedule the call to 3pm')).toBeNull();
  });
  it('blocks credentials and IBANs', () => {
    const samples = [
      `-----BEGIN ${'RSA '}PRIVATE KEY-----\nabc`,
      `key ${'AKIA' + 'A'.repeat(16)}`,
      `token ${'ghp_' + 'a'.repeat(36)}`,
      `use ${'sk-' + 'x'.repeat(24)}`,
      `bot ${'xoxb-' + '1'.repeat(12)}`,
      'password: hunter22',
      'API_KEY=abcdef123',
    ];
    for (const s of samples) expect(guard(s)).toMatch(/password or access key/);
    expect(guard('pay to DE89 3704 0044 0532 0130 00')).toMatch(/IBAN/);
    expect(guard('pay to DE89370400440532013000')).toMatch(/IBAN/);
    expect(guard('IBAN BE68 5390 0754 7034 BIC GKCCBEBB')).toMatch(/IBAN/);
    for (const s of ['GB82WEST12345698765432', 'NL91 ABNA 0417 1643 00', 'FR14 2004 1010 0505 0001 3M02 606', 'MT84MALT011000012345MTLCAST001S', 'LC55HEMM000100010012001200023015']) expect(guard(`pay ${s}`), s).toMatch(/IBAN/);
  });
  it('does not take order or tracking numbers for IBANs', () => {
    const d = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
    for (let i = 0; i < 2000; i++) {
      for (const ref of [`US${d(2)} ${d(4)} ${d(4)} ${d(4)} ${d(4)}`, `DE${d(2)}${d(16)}`]) expect(guard(`Order ref ${ref} shipped`) ?? '', ref).not.toMatch(/IBAN/);
    }
  });
  it('does not flag ordinary words as credentials', () => {
    expect(guard('call me at 555 1234')).toBeNull();
    expect(guard('- Reset your password at the link')).toBeNull();
    expect(guard('- Email Bob the password reset link')).toBeNull();
    expect(guard('- Ask for the secret santa list and a task-tracker token budget')).toBeNull();
    expect(guard('ref DE00 3704 0044 0532 0130 00')).toBeNull();
  });
});

describe('consent', () => {
  it('labels health and finances', () => {
    expect(consent('her prescription renewal')).toEqual(['health']);
    expect(consent('Q3 salary bands')).toEqual(['finances']);
    expect(consent('lunch at noon')).toEqual([]);
    expect(consent('diagnose the build failure')).toEqual([]);
  });
});

describe('inQuiet', () => {
  it('handles windows across midnight', () => {
    expect(inQuiet('23:00', '22:00', '07:00')).toBe(true);
    expect(inQuiet('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuiet('12:00', '22:00', '07:00')).toBe(false);
    expect(inQuiet('13:00', '12:00', '14:00')).toBe(true);
  });
});

describe('parseKiloEvents', () => {
  it('collects session, text and tools', () => {
    const out = [
      'INFO log line',
      JSON.stringify({ type: 'step_start', sessionID: 's1', part: {} }),
      JSON.stringify({ type: 'text', sessionID: 's1', part: { type: 'text', text: 'let me look' } }),
      JSON.stringify({ type: 'tool_use', sessionID: 's1', part: { type: 'tool', tool: 'read', state: { status: 'completed' } } }),
      JSON.stringify({ type: 'step_start', sessionID: 's1', part: {} }),
      JSON.stringify({ type: 'text', sessionID: 's1', part: { type: 'text', text: 'hello' } }),
      JSON.stringify({ type: 'step_start', sessionID: 's1', part: {} }),
    ].join('\n');
    expect(parseKiloEvents(out)).toEqual({
      sessionID: 's1',
      text: 'let me look\n\nhello',
      finalText: 'hello',
      tools: [{ tool: 'read', status: 'completed', title: '' }],
      errors: [],
    });
  });
});

describe('describeTool', () => {
  it('turns tool calls into plain phrases', async () => {
    const { describeTool } = await import('./kilo.js');
    expect(describeTool('read', { filePath: '/x/workspace/acme-brief.md' })).toBe('reading acme-brief.md');
    expect(describeTool('websearch', { query: 'Acme Robotics' })).toBe('searching the web for “Acme Robotics”');
    expect(describeTool('webfetch', { url: 'https://acme.example/about' })).toBe('reading acme.example');
    expect(describeTool('gmail_search_emails', {})).toBe('using gmail');
    expect(describeTool('glob', {})).toBe('searching the workspace');
  });
});
