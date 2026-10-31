import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { buildInstall, type McpListing, type McpSearch } from '../../../src/shared/market';
import { CURATED_SKILLS, type SkillInfo, type SkillPreview } from '../../../src/shared/skills';
import { post, request } from '../api';

const LOCAL_WARNING =
  'This runs on your computer with your permissions. Duet reads on its own only through read-only tools; anything that changes something waits for your approval.';

/** Install and import both end here: refresh the apps list and say what went wrong, if anything. */
function useAfter() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['connectors'] });
}

export function Browse() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['market-mcp', q],
    queryFn: ({ pageParam }) => request<McpSearch>(`/market/mcp?q=${encodeURIComponent(q)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
  const servers = list.data?.pages.flatMap((p) => p.servers) ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim());
  };
  return (
    <div className="market">
      <form className="market-search" onSubmit={submit}>
        <label htmlFor="market-q" className="sr-only">
          Search the MCP Registry
        </label>
        <input id="market-q" type="search" placeholder="Search servers: email, calendar, files…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-quiet btn-sm">
          Search
        </button>
      </form>
      <p className="hint">
        From the official MCP Registry. Anyone can publish there and nothing is checked for you: install only what you trust.
      </p>
      {list.error && (
        <p className="is-error apps-error" role="alert">
          {list.error.message}
        </p>
      )}
      <div className="catalog">
        {servers.map((s) => (
          <McpCard key={s.name} s={s} />
        ))}
      </div>
      {list.isFetching && <p className="muted">Looking…</p>}
      {!list.isFetching && !list.error && servers.length === 0 && <p className="hint">Nothing here can be installed from this search.</p>}
      {list.hasNextPage && !list.isFetching && (
        <button type="button" className="btn btn-text btn-sm" onClick={() => list.fetchNextPage()}>
          Show more
        </button>
      )}
    </div>
  );
}

function McpCard({ s }: { s: McpListing }) {
  const after = useAfter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const local = s.plan.type === 'local';
  const install = useMutation({
    mutationFn: () => post('/market/mcp/install', { name: s.name, values, confirmed: true }),
    onSuccess: () => {
      setDone(true);
      setError(null);
      void after();
    },
    onError: (e) => setError(e.message),
  });
  const built = buildInstall(s.plan, values);
  const shown = 'error' in built ? null : built;
  const fields = s.plan.fields;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    install.mutate();
  };
  return (
    <div className={`preset ${open ? 'is-open' : ''}`}>
      <button type="button" className="preset-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="app-badge" aria-hidden="true">
          {s.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="preset-text">
          <span className="preset-name">{s.title}</span>
          <span className="preset-blurb">{s.description || s.publisher}</span>
        </span>
        <Plus size={16} aria-hidden="true" className="preset-plus" />
      </button>
      {open && (
        <form className="preset-form" onSubmit={submit}>
          <p className="hint">
            {s.publisher}
            {s.repo && (
              <>
                {' · '}
                <a href={s.repo} target="_blank" rel="noreferrer noopener">
                  Source <ExternalLink size={12} aria-hidden="true" />
                </a>
              </>
            )}
          </p>
          {fields.map((f) => (
            <div key={f.key} className="field">
              <label htmlFor={`m-${s.name}-${f.key}`}>
                {f.label}
                {f.required ? '' : ' (optional)'}
              </label>
              <input
                id={`m-${s.name}-${f.key}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.default}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </div>
          ))}
          {local ? (
            <>
              <p className="warning">{LOCAL_WARNING}</p>
              <code className="command">{shown?.command ? shown.command.join(' ') : 'Fill in the fields above to see the command.'}</code>
            </>
          ) : (
            <p className="hint">Connects to a server run by its publisher. If it needs you to sign in, the button appears in Your apps.</p>
          )}
          {error && (
            <p className="is-error" role="alert">
              {error}
            </p>
          )}
          {done ? (
            <p className="hint">Installed. Find it under Your apps.</p>
          ) : (
            <button type="submit" className="btn btn-send btn-sm" disabled={install.isPending || !shown}>
              {install.isPending ? 'Installing…' : local ? 'Run on this computer and install' : 'Install'}
            </button>
          )}
        </form>
      )}
    </div>
  );
}

interface Found {
  key: string;
  source: string;
  name: string;
  line: string;
  envKeys: string[];
}

/** Servers already set up for Claude or Codex on this computer, plus pasted configs. */
export function Import() {
  const after = useAfter();
  const found = useQuery({ queryKey: ['mcp-discover'], queryFn: () => request<{ servers: Found[] }>('/connectors/discover'), retry: false });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useMutation({
    mutationFn: () => post<{ added: number; errors: string[] }>('/connectors/import', { keys: [...picked], text: text.trim() || undefined, confirmed: true }),
    onSuccess: (r) => {
      setMsg({ ok: !r.errors.length, text: `Added ${r.added}.${r.errors.length ? ` ${r.errors.join(' ')}` : ''}` });
      setPicked(new Set());
      setText('');
      void after();
    },
    onError: (e) => setMsg({ ok: false, text: e.message }),
  });
  const servers = found.data?.servers ?? [];
  const toggle = (k: string) => setPicked((p) => (p.has(k) ? new Set([...p].filter((x) => x !== k)) : new Set(p).add(k)));
  const anyLocal = servers.some((s) => picked.has(s.key) && !/^https?:\/\//.test(s.line)) || /"command"|command\s*=/.test(text);
  return (
    <div className="market">
      <p className="hint">Use the servers you already have in Claude or Codex, with the same settings.</p>
      {servers.length > 0 && (
        <fieldset className="machines">
          <legend>Found on this computer</legend>
          {servers.map((s) => (
            <label key={s.key} className="check">
              <input type="checkbox" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
              <span>
                {s.name} <span className="muted">{s.source}</span>
                <span className="hint">
                  <code>{s.line}</code>
                  {s.envKeys.length > 0 && ` · uses ${s.envKeys.join(', ')}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {found.data && servers.length === 0 && <p className="hint">No Claude or Codex servers found on this computer.</p>}
      <div className="field">
        <label htmlFor="import-text">Or paste a config (.mcp.json or Codex config.toml)</label>
        <textarea id="import-text" rows={5} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={'{ "mcpServers": { "mail": { "command": "npx", "args": ["-y", "mail-mcp"] } } }'} />
      </div>
      {anyLocal && <p className="warning">{LOCAL_WARNING}</p>}
      {msg && (
        <p className={msg.ok ? 'hint' : 'is-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
      <button type="button" className="btn btn-send btn-sm" disabled={run.isPending || (!picked.size && !text.trim())} onClick={() => run.mutate()}>
        {run.isPending ? 'Importing…' : anyLocal ? 'Run on this computer and import' : 'Import'}
      </button>
    </div>
  );
}

export function SkillsSection() {
  const qc = useQueryClient();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => request<{ skills: SkillInfo[] }>('/skills') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['skills'] });
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [source, setSource] = useState<{ url: string } | { text: string } | null>(null);

  const act = useMutation({
    mutationFn: ([path, body]: [string, unknown]) => post<{ name?: string }>(path, body),
    onSuccess: () => setError(null),
    onError: (e) => setError(e.message),
    onSettled: refresh,
  });
  const look = useMutation({
    mutationFn: (src: { url: string } | { text: string }) => post<SkillPreview>('/skills/preview', src).then((p) => ({ p, src })),
    onSuccess: ({ p, src }) => {
      setError(null);
      setPreview(p);
      setSource(src);
    },
    onError: (e) => setError(e.message),
  });
  const install = (src: { url: string } | { text: string }) =>
    act.mutateAsync(['/skills/install', src]).then(() => {
      setPreview(null);
      setSource(null);
      setUrl('');
      setPasted('');
    }, () => undefined);
  const have = new Set(skills.data?.skills.map((s) => s.name));

  return (
    <section className="apps-section" aria-label="Skills">
      <h3>Skills</h3>
      <p className="hint">
        A skill is a set of instructions Duet follows when it fits the job. Duet has no shell, so skills that run scripts won't work. A skill steers what Duet
        does: install them only from sources you trust.
      </p>
      {error && (
        <p className="is-error apps-error" role="alert">
          {error}
        </p>
      )}
      {skills.data && skills.data.skills.length > 0 && (
        <ul className="apps-list">
          {skills.data.skills.map((s) => (
            <li key={s.name} className="app-row">
              <span className="app-badge" aria-hidden="true">
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="app-main">
                <div className="app-name">
                  {s.name} <span className="muted">{s.source}</span>
                </div>
                <div className="app-state">{s.description}</div>
                <div className="app-controls">
                  <label className="check check-inline">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => act.mutate(['/skills/update', { name: s.name, enabled: e.target.checked }])} />
                    <span>On</span>
                  </label>
                  {confirming === s.name ? (
                    <span className="confirm">
                      Remove {s.name}?
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => act.mutate(['/skills/remove', { name: s.name }], { onSettled: () => setConfirming(null) })}>
                        Remove
                      </button>
                      <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(s.name)}>
                      Remove…
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="catalog">
        {CURATED_SKILLS.filter((c) => !have.has(c.id)).map((c) => (
          <div key={c.id} className="preset">
            <button type="button" className="preset-head" disabled={look.isPending || act.isPending} onClick={() => look.mutate({ url: `https://github.com/${c.repo}/tree/${c.ref}/${c.path}` })}>
              <span className="app-badge" aria-hidden="true">
                {c.name.slice(0, 1)}
              </span>
              <span className="preset-text">
                <span className="preset-name">{c.name}</span>
                <span className="preset-blurb">{c.blurb}</span>
              </span>
              <Plus size={16} aria-hidden="true" className="preset-plus" />
            </button>
          </div>
        ))}
      </div>

      {preview && source && (
        <div className="custom-app" role="region" aria-label="Skill preview">
          <strong>{preview.name}</strong> <span className="muted">{preview.source}</span>
          <p className="hint">{preview.description}</p>
          <pre className="skill-body">{preview.body.slice(0, 1500)}{preview.body.length > 1500 ? '\n…' : ''}</pre>
          <div className="reset">
            <button type="button" className="btn btn-send btn-sm" disabled={act.isPending} onClick={() => install(source)}>
              {act.isPending ? 'Installing…' : `Install ${preview.name}`}
            </button>
            <button type="button" className="btn btn-text btn-sm" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <form
        className="market-search"
        onSubmit={(e) => {
          e.preventDefault();
          look.mutate(pasted.trim() ? { text: pasted } : { url: url.trim() });
        }}
      >
        <label htmlFor="skill-url" className="sr-only">
          GitHub link to a skill folder
        </label>
        <input id="skill-url" inputMode="url" placeholder="Link to a skill folder on GitHub" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="btn btn-quiet btn-sm" disabled={look.isPending || (!url.trim() && !pasted.trim())}>
          {look.isPending ? 'Looking…' : 'Preview'}
        </button>
      </form>
      <details className="custom-key">
        <summary>Or paste a SKILL.md</summary>
        <textarea aria-label="SKILL.md contents" rows={6} spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'---\nname: my-skill\ndescription: When to use it\n---\nWhat to do…'} />
      </details>
    </section>
  );
}
