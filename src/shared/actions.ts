/**
 * Proposal ACTIONS helpers shared by the server (command runner) and the UI (rendering).
 * Keep this free of Node APIs so the web bundle can import it.
 */

/** Map curly quotes / collapse whitespace for fuzzy command compares only. */
export function normCommand(s: string): string {
  return s
    .trim()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/\s+/g, ' ');
}

/**
 * Models often write list-marker + fence on one line. Fences only count when ``` starts the line
 * (optionally indented), so move the fence to the next line.
 */
export function healActionFences(text: string): string {
  return text.replace(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(```[^\n`]*)\s*$/gm, '$1\n$2');
}

export type ActionPart =
  | { type: 'text'; text: string }
  | { type: 'code'; lang: string; code: string };

/** Split ACTIONS markdown into prose and fenced command blocks (after healing). */
export function splitActions(text: string): ActionPart[] {
  const src = healActionFences(text.trim());
  const parts: ActionPart[] = [];
  const re = /^([ \t]*)```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) {
      const prose = cleanProse(src.slice(last, start));
      if (prose) parts.push({ type: 'text', text: prose });
    }
    const indent = m[1];
    const lang = m[2].trim();
    const code = m[3]
      .split('\n')
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
      .join('\n')
      .trim();
    if (code) parts.push({ type: 'code', lang, code });
    last = start + m[0].length;
  }
  if (last < src.length) {
    const prose = cleanProse(src.slice(last));
    if (prose) parts.push({ type: 'text', text: prose });
  }
  return parts;
}

/** Drop empty list markers left behind when a fence moved to the next line. */
function cleanProse(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .filter((l) => !/^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/.test(l))
    .join('\n')
    .trim();
}

/**
 * Each fenced block counts as one command; so does any single line inside it.
 * Only line-leading fences count, so inline fences cannot smuggle a command.
 */
export function commandsIn(text: string): string[] {
  const out: string[] = [];
  for (const part of splitActions(text)) {
    if (part.type !== 'code') continue;
    out.push(part.code, ...part.code.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return out;
}

export const hasCommands = (text: string) => text.includes('```') || commandsIn(text).length > 0;

/**
 * Rewrite ACTIONS so each command is a clean fenced block the UI and runner can read.
 * Identical commands (after quote/whitespace normalization) appear only once.
 */
export function normalizeActions(text: string): string {
  const parts = splitActions(text);
  if (!parts.length) return text.trim();

  const out: string[] = [];
  const seen = new Set<string>();
  let pendingText: string | null = null;

  const flushText = () => {
    if (pendingText) {
      out.push(pendingText);
      pendingText = null;
    }
  };

  for (const part of parts) {
    if (part.type === 'text') {
      flushText();
      pendingText = part.text;
      continue;
    }
    const key = normCommand(part.code);
    if (seen.has(key)) {
      pendingText = null;
      continue;
    }
    seen.add(key);
    flushText();
    const lang = part.lang || 'bash';
    out.push('```' + lang + '\n' + part.code + '\n```');
  }
  flushText();

  // No fences found — keep the original prose proposal (e.g. "send email to bob").
  if (!seen.size) return text.trim();
  return out.join('\n\n').trim();
}
