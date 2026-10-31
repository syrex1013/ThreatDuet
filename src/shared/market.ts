/**
 * What it takes to install one server from the MCP Registry, as the UI and the server both see it.
 * The server builds the plan from the registry entry; the UI only collects the values.
 */
export interface McpField {
  key: string;
  /** env: environment variable. header: HTTP header. arg: command-line value. */
  kind: 'env' | 'header' | 'arg';
  label: string;
  secret: boolean;
  required: boolean;
  default?: string;
  /** header only: the value around the input, e.g. "Bearer {}". */
  template?: string;
  /** arg only: the flag that goes before the value, e.g. "--root". */
  flag?: string;
}

export type McpPlan =
  | { type: 'remote'; url: string; staticHeaders: Record<string, string>; fields: McpField[] }
  | { type: 'local'; argv: (string | { field: string })[]; staticEnv: Record<string, string>; fields: McpField[] };

export interface McpListing {
  /** Registry name, e.g. io.github.org/server. The install route looks the entry up again by this. */
  name: string;
  title: string;
  description: string;
  publisher: string;
  repo: string | null;
  plan: McpPlan;
}

export interface McpSearch {
  servers: McpListing[];
  next: string | null;
}

export interface BuiltInstall {
  url?: string;
  headers?: Record<string, string>;
  command?: string[];
  env?: Record<string, string>;
}

/** Fills the plan with the user's values. Returns an error text when a required value is missing. */
export function buildInstall(plan: McpPlan, values: Record<string, string>): BuiltInstall | { error: string } {
  const val = (f: McpField) => (values[f.key] ?? f.default ?? '').trim();
  for (const f of plan.fields) if (f.required && !val(f)) return { error: `Fill in ${f.label}.` };

  if (plan.type === 'remote') {
    const headers = { ...plan.staticHeaders };
    for (const f of plan.fields) if (val(f)) headers[f.key] = (f.template ?? '{}').replace('{}', val(f));
    return { url: plan.url, headers };
  }
  const byKey = new Map(plan.fields.map((f) => [f.key, f]));
  const command: string[] = [];
  for (const part of plan.argv) {
    if (typeof part === 'string') {
      command.push(part);
      continue;
    }
    const f = byKey.get(part.field);
    const v = f ? val(f) : '';
    if (v) command.push(...(f?.flag ? [f.flag, v] : [v]));
  }
  const env = { ...plan.staticEnv };
  for (const f of plan.fields) if (f.kind === 'env' && val(f)) env[f.key] = val(f);
  return { command, env };
}
