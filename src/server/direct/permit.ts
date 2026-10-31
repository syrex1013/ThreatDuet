import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE } from '../config.js';

type Rules = Record<string, unknown>;

/** Kilo's rule evaluation: `*` matches anything, rules apply in order, the last match wins. */
function decide(rules: Rules, key: string): string | null {
  let result: string | null = null;
  for (const [pattern, action] of Object.entries(rules)) {
    if (typeof action !== 'string') continue;
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(key)) result = action;
  }
  return result;
}

export interface Policy {
  /** allow, or deny (an `ask` rule counts as deny unless the task was approved). */
  tool: (name: string) => 'allow' | 'deny';
  /** For the file-changing tools: the edit rules, judged by workspace path. */
  edit: (relPath: string) => 'allow' | 'deny';
}

const EDITING = new Set(['write', 'edit']);

/** The rules written to workspace/kilo.json for this agent: the one source both Kilo and the built-in agent obey. */
export async function policyFor(agent: 'duet' | 'code', auto: boolean): Promise<Policy> {
  const cfg = JSON.parse(await fs.readFile(path.join(WORKSPACE, 'kilo.json'), 'utf8').catch(() => '{}'));
  const rules: Rules = { ...(cfg.permission ?? {}), ...(cfg.agent?.[agent]?.permission ?? {}) };
  const final = (v: string | null, fallback: 'allow' | 'deny'): 'allow' | 'deny' => (v === 'allow' ? 'allow' : v === 'deny' ? 'deny' : v === 'ask' ? (auto ? 'allow' : 'deny') : fallback);
  // An agent with a catch-all rule is deny-by-default; the other is allow-by-default, as in Kilo.
  const dflt: 'allow' | 'deny' = decide(rules, '\u0000') === 'deny' ? 'deny' : 'allow';
  const editRules = (rules.edit && typeof rules.edit === 'object' ? rules.edit : {}) as Rules;
  return {
    tool: (name) => {
      if (EDITING.has(name)) return typeof rules.edit === 'string' ? final(rules.edit, 'allow') : 'allow';
      return final(decide(rules, name), dflt);
    },
    edit: (rel) => final(decide(editRules, rel.split(path.sep).join('/')), 'allow'),
  };
}
