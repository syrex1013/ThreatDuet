import type { ToolUse } from '../shared/types.js';

export interface FollowUp {
  at: number;
  what: string;
}

export interface ParsedReply {
  text: string;
  actions: string | null;
  remember: string[];
  /** The agent wants another autonomous step. */
  continue: boolean;
  followups: FollowUp[];
  /** Check-in triage: high interrupts the user, low waits for the next brief. */
  priority: 'high' | 'low' | null;
}

/** Splits Duet's reply into visible text and its control markers. */
export function parseReply(raw: string, now = Date.now()): ParsedReply {
  const remember: string[] = [];
  const followups: FollowUp[] = [];
  let priority: ParsedReply['priority'] = null;
  let cont = false;
  let text = raw
    .replace(/<<REMEMBER:?\s*([\s\S]*?)>>/g, (_, m: string) => {
      remember.push(m.trim());
      return '';
    })
    .replace(/<<FOLLOWUP:?\s*([^|>]*)\|([\s\S]*?)>>/g, (_, when: string, what: string) => {
      const at = Date.parse(when.trim());
      // Ignore unparseable or past times rather than firing immediately.
      if (Number.isFinite(at) && at > now && what.trim()) followups.push({ at, what: what.trim() });
      return '';
    })
    .replace(/<<PRIORITY:?\s*(high|low)\s*>>/gi, (_, p: string) => {
      priority = p.toLowerCase() as 'high' | 'low';
      return '';
    })
    .replace(/<<CONTINUE>>/g, () => {
      cont = true;
      return '';
    });
  let actions: string | null = null;
  const start = text.indexOf('<<ACTIONS');
  if (start !== -1) {
    // An unclosed block still counts as a proposal: parsing errors fail toward asking.
    const end = text.indexOf('ACTIONS>>', start);
    actions = text.slice(start + '<<ACTIONS'.length, end === -1 ? undefined : end).trim();
    text = text.slice(0, start) + (end === -1 ? '' : text.slice(end + 'ACTIONS>>'.length));
    if (!actions || /^none\.?$/i.test(actions)) actions = null;
  }
  return { text: text.trim(), actions, remember, continue: cont, followups, priority };
}

export interface KiloResult {
  sessionID: string | null;
  /** Text of every step. */
  text: string;
  /** Text of the last step that produced any, i.e. the answer without the narration before tool calls. */
  finalText: string;
  tools: ToolUse[];
  errors: string[];
}

/** Parses `kilo run --format json` newline-delimited events. */
export function parseKiloEvents(stdout: string): KiloResult {
  const result: KiloResult = { sessionID: null, text: '', finalText: '', tools: [], errors: [] };
  const texts: string[] = [];
  let step: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    result.sessionID ??= event.sessionID ?? null;
    const part = event.part ?? {};
    if (event.type === 'step_start') step = [];
    else if (part.type === 'text' && part.text) {
      texts.push(part.text);
      step.push(part.text);
      result.finalText = step.join('\n\n');
    } else if (part.type === 'tool') result.tools.push({ tool: part.tool, status: part.state?.status, title: part.state?.title ?? '' });
    else if (event.type === 'error') result.errors.push(JSON.stringify(event.error ?? event).slice(0, 500));
  }
  result.text = texts.join('\n\n');
  return result;
}
