import { describe, expect, it } from 'vitest';
import { checkUrl, parseMcpList } from './connectors.js';
import { connectorRules } from './store.js';

/** Kilo's evaluation: `*` matches anything, rules apply in order, the last match wins. */
function decide(rules: Record<string, string>, tool: string): string {
  let result = 'deny';
  for (const [pattern, action] of Object.entries(rules)) {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(tool)) result = action;
  }
  return result;
}

describe('connector tool rules', () => {
  const rules = { '*': 'deny', ...connectorRules(['zapier', 'notion', 'atlassian', 'composio', 'linear', 'deepwiki', 'slack', 'github', 'stripe', 'x']) };

  it.each([
    'zapier_gmail_find_email',
    'zapier_google_calendar_find_events',
    'notion_notion-search',
    'notion_notion-fetch',
    'atlassian_getJiraIssue',
    'atlassian_searchJiraIssuesUsingJql',
    'composio_GMAIL_FETCH_EMAILS',
    'linear_list_issues',
    'deepwiki_read_wiki_structure',
    'deepwiki_ask_question',
    'github_get_pull_request',
  ])('lets Duet read on its own: %s', (tool) => expect(decide(rules, tool)).toBe('allow'));

  it.each([
    'slack_lock_thread', // "thread" is not "read"
    'github_request_review', // "review" is not "view"
    'stripe_close_account', // "account" is not "count"
    'zapier_gmail_send_email',
    'zapier_gmail_mark_as_read',
    'notion_notion-update-page',
    'atlassian_createJiraIssue',
    'atlassian_transitionJiraIssue',
    'linear_get_and_delete_issue',
    'zapier_webhooks_by_zapier_get',
    'x_fetch_url',
    'composio_GMAIL_SEND_EMAIL',
    'other_get_issue', // an app without "reads on its own"
    'github_unknownverb_thing',
  ])('keeps behind approval: %s', (tool) => expect(decide(rules, tool)).toBe('deny'));
});

describe('kilo mcp list parsing', () => {
  const sample = [
    '┌  MCP Servers',
    '●  ✓ deepwiki connected',
    '│      https://mcp.deepwiki.com/mcp',
    '●  ⚠ notion needs authentication',
    '│      https://mcp.notion.com/mcp',
    '●  ○ offone disabled',
    '●  ✗ broken failed',
    '│      SSE error: getaddrinfo ENOTFOUND https://mcp.example/mcp/SECRETPATH123',
    '│      https://mcp.example/mcp/SECRETPATH123',
    '└  4 server(s)',
  ].join('\n');

  it('reads every state and never keeps an address', () => {
    const s = parseMcpList(sample);
    expect(s).toEqual({
      deepwiki: { state: 'connected', detail: null },
      notion: { state: 'needs-sign-in', detail: null },
      offone: { state: 'off', detail: null },
      broken: { state: 'error', detail: 'SSE error: getaddrinfo ENOTFOUND (address hidden)' },
    });
    expect(JSON.stringify(s)).not.toContain('SECRETPATH');
  });
});

describe('app addresses', () => {
  it('accepts https, and http only on this computer', () => {
    expect(checkUrl('https://mcp.notion.com/mcp')).toBe('https://mcp.notion.com/mcp');
    expect(checkUrl('http://localhost:3000/mcp')).toBe('http://localhost:3000/mcp');
    expect(checkUrl('http://mcp.example.com/mcp')).toBeNull();
    expect(checkUrl('javascript:alert(1)')).toBeNull();
    expect(checkUrl('not a url')).toBeNull();
  });
});
