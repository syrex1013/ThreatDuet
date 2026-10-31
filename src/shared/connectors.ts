/**
 * One-click apps. Only endpoints confirmed against the vendor's own docs belong here; anything else
 * can still be added as "Another app" with its MCP server address.
 *
 * auth:
 * - oauth: Kilo runs the browser sign-in; tokens stay in Kilo's store.
 * - key: the user pastes an API key, sent as a header (keyHeader, with keyPrefix).
 * - personal-url: the vendor gives each user a private server address; the address is the secret.
 * - none: public server, nothing to sign in to.
 */
export interface ConnectorPreset {
  id: string;
  name: string;
  /** What Duet can do with it, in a few words. */
  blurb: string;
  url: string;
  auth: 'oauth' | 'key' | 'personal-url' | 'none';
  keyHeader?: string;
  keyPrefix?: string;
  keyLabel?: string;
  /** Where the user gets the key or personal address. */
  keyHelp?: string;
  /** Vendor documentation for the server. */
  source: string;
}

export const PRESETS: ConnectorPreset[] = [
  { id: 'zapier', name: 'Zapier', blurb: 'Gmail, Google Calendar, Slack and thousands of other apps through one sign-in', url: 'https://mcp.zapier.com/api/v1/connect', auth: 'oauth', source: 'https://docs.zapier.com/mcp/overview/how-connections-work' },
  { id: 'composio', name: 'Composio', blurb: 'Email, calendar, chat and 250+ apps through one sign-in', url: 'https://connect.composio.dev/mcp', auth: 'oauth', source: 'https://docs.composio.dev/docs/composio-connect' },
  { id: 'notion', name: 'Notion', blurb: 'Pages, databases and notes', url: 'https://mcp.notion.com/mcp', auth: 'oauth', source: 'https://developers.notion.com/docs/get-started-with-mcp' },
  { id: 'linear', name: 'Linear', blurb: 'Issues, projects and cycles', url: 'https://mcp.linear.app/mcp', auth: 'oauth', source: 'https://linear.app/docs/mcp' },
  { id: 'atlassian', name: 'Atlassian', blurb: 'Jira issues and Confluence pages', url: 'https://mcp.atlassian.com/v2/mcp', auth: 'oauth', source: 'https://github.com/atlassian/atlassian-mcp-server' },
  { id: 'stripe', name: 'Stripe', blurb: 'Payments, invoices and customers', url: 'https://mcp.stripe.com', auth: 'oauth', source: 'https://docs.stripe.com/mcp' },
  { id: 'gusto', name: 'Gusto', blurb: 'Payroll, time and people', url: 'https://mcp.api.gusto.com', auth: 'oauth', source: 'https://gusto.com/product/integrations/gusto_mcp' },
  { id: 'calendly', name: 'Calendly', blurb: 'Meetings and availability', url: 'https://mcp.calendly.com', auth: 'oauth', source: 'https://developer.calendly.com/docs/mcp/calendly-mcp-server' },
  { id: 'airtable', name: 'Airtable', blurb: 'Bases and records', url: 'https://mcp.airtable.com/mcp', auth: 'oauth', source: 'https://airtable.com/developers/agents/mcp/other' },
  { id: 'monday', name: 'monday.com', blurb: 'Boards and items', url: 'https://mcp.monday.com/mcp', auth: 'oauth', source: 'https://github.com/mondaycom/mcp' },
  { id: 'clickup', name: 'ClickUp', blurb: 'Tasks and docs', url: 'https://mcp.clickup.com/mcp', auth: 'oauth', source: 'https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server' },
  { id: 'todoist', name: 'Todoist', blurb: 'Tasks and projects', url: 'https://ai.todoist.net/mcp', auth: 'oauth', source: 'https://github.com/Doist/todoist-ai' },
  { id: 'intercom', name: 'Intercom', blurb: 'Conversations and customers', url: 'https://mcp.intercom.com/mcp', auth: 'oauth', source: 'https://developers.intercom.com/docs/guides/mcp' },
  { id: 'sentry', name: 'Sentry', blurb: 'Errors and releases', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', source: 'https://github.com/getsentry/sentry-mcp' },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Repositories, issues and pull requests',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'key',
    keyHeader: 'Authorization',
    keyPrefix: 'Bearer ',
    keyLabel: 'GitHub personal access token',
    keyHelp: 'https://github.com/settings/personal-access-tokens',
    source: 'https://github.com/github/github-mcp-server',
  },
];
