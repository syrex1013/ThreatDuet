import { describe, expect, it } from 'vitest';
import { parseKiloEvents, parseReply } from './parse.js';
import { guard, inQuiet } from './policy.js';

describe('parseReply', () => {
  it('extracts actions and memory', () => {
    const r = parseReply('Drafted.\n<<REMEMBER: prefers short emails>>\n<<ACTIONS\n- send email to bob\nACTIONS>>');
    expect(r).toMatchObject({ text: 'Drafted.', actions: '- send email to bob', remember: ['prefers short emails'], continue: false });
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
