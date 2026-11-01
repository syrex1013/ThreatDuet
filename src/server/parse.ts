import { Cron } from 'croner';
import { normalizeActions } from '../shared/actions.js';
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
  /** Suggested recurring routines; the user has to turn each one on. */
  routines: { cron: string; what: string }[];
  /** Tasks Duet came up with: `start` ones it runs on its own, the rest it suggests. */
  tasks: { title: string; details: string; start: boolean }[];
}

/** The first run of a cron pattern after `from`, or null if it is invalid or never runs again. */
export function nextRoutineRun(cron: string, from = new Date()): number | null {
  try {
    return new Cron(cron, { paused: true }).nextRun(from)?.getTime() ?? null;
  } catch {
    return null;
  }
}

/** A 5-field pattern with one fixed minute runs at most hourly, so a routine never fires more often than that. */
export function routineCron(expr: string): boolean {
  const f = expr.trim().split(/\s+/);
  return f.length === 5 && /^\d{1,2}$/.test(f[0]) && nextRoutineRun(expr) !== null;
}

/** Splits Duet's reply into visible text and its control markers. */
export function parseReply(raw: string, now = Date.now()): ParsedReply {
  const remember: string[] = [];
  const followups: FollowUp[] = [];
  const routines: ParsedReply['routines'] = [];
  const tasks: ParsedReply['tasks'] = [];
  let priority: ParsedReply['priority'] = null;
  let cont = false;
  let text = raw
    .replace(/<<REMEMBER:?\s*([\s\S]*?)>>/g, (_, m: string) => {
      remember.push(m.trim());
      return '';
    })
    .replace(/<<FOLLOWUP:?\s*([^|>]*)\|([\s\S]*?)>>/g, (_, when: string, what: string) => {
      const w = when.trim();
      // Date-only ISO strings parse as UTC midnight; read them as 09:00 local like the date-times.
      const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(w) ? `${w}T09:00` : w);
      // Ignore unparseable or past times rather than firing immediately.
      if (Number.isFinite(at) && at > now && what.trim()) followups.push({ at, what: what.trim() });
      return '';
    })
    .replace(/<<ROUTINE:?\s*([^|>]*)\|([\s\S]*?)>>/g, (_, cron: string, what: string) => {
      if (routineCron(cron) && what.trim()) routines.push({ cron: cron.trim().split(/\s+/).join(' '), what: what.trim() });
      return '';
    })
    // Models often drop the details or wrap the marker in backticks; both still count.
    .replace(/`?<<(TASK|SUGGEST):?\s*([^|>]*)(?:\|([\s\S]*?))?>>`?/g, (_, kind: string, title: string, details = '') => {
      if (title.trim()) tasks.push({ title: title.trim().slice(0, 120), details: details.trim().slice(0, 2000), start: kind === 'TASK' });
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
  // An unclosed block still counts as a proposal: parsing errors fail toward asking. The last block is the final word.
  text = text.replace(/<<ACTIONS([\s\S]*?)(?:ACTIONS>>|$)/g, (_, a: string) => {
    actions = a.trim();
    return '';
  });
  if (!actions || /^none\.?$/i.test(actions)) actions = null;
  else actions = normalizeActions(actions);
  return { text: text.trim(), actions, remember, continue: cont, followups, priority, routines, tasks };
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
