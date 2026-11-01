import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Knowledge, Message, PermissionRule, Project, StateResponse } from '../../../src/shared/types';
import { post, request } from '../api';
import { isPhone } from '../connection';
import { t } from '../i18n';
import { Sheet } from './Sheet';
import './work.css';

type Tab = 'projects' | 'tasks' | 'knowledge' | 'watches' | 'workflows' | 'receipts' | 'provider' | 'history';
const tabs: Tab[] = ['projects', 'tasks', 'knowledge', 'watches', 'workflows', 'receipts', 'provider', 'history'];
const labels: Record<Tab, string> = { projects: 'Projects', tasks: 'Tasks', knowledge: 'Knowledge', watches: 'Watches', workflows: 'Workflows', receipts: 'Receipts and permissions', provider: 'Provider and usage', history: 'History' };

function Field({ label, value, onChange, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  const id = useId();
  return <div className="work-field"><label htmlFor={id}>{t(label)}</label>{multiline ? <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} /> : <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />}</div>;
}

export function WorkSpace({ state, channel, onSelect, onClose }: { state: StateResponse; channel?: string; onSelect: (channel: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('projects');
  const [projectId, setProjectId] = useState(state.projects?.find((p) => p.channel === channel)?.id ?? '');
  const project = state.projects?.find((p) => p.id === projectId);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [details, setDetails] = useState('');
  const [device, setDevice] = useState('coordinator');
  const [query, setQuery] = useState('');
  const [fact, setFact] = useState('');
  const [source, setSource] = useState('user');
  const [kind, setKind] = useState<Knowledge['kind']>('fact');
  const [factId, setFactId] = useState('');
  const [tool, setTool] = useState('');
  const [argumentsText, setArgumentsText] = useState('{}');
  const [match, setMatch] = useState('');
  const [every, setEvery] = useState('15');
  const [inputs, setInputs] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const [provider, setProvider] = useState(state.provider ?? { baseUrl: '', keyEnv: 'OPENAI_API_KEY', chatModel: '', taskModel: '', maxRequests: 40, maxTokens: 0 });
  const knowledge = useQuery({ queryKey: ['knowledge'], queryFn: () => request<{ knowledge: Knowledge[] }>('/knowledge'), enabled: tab === 'knowledge' });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: () => request<{ permissions: PermissionRule[] }>('/permissions'), enabled: tab === 'receipts' });
  const history = useQuery({ queryKey: ['history', query], queryFn: () => request<{ messages: Message[] }>(`/history?q=${encodeURIComponent(query)}`), enabled: tab === 'history' });
  const tools = useQuery({ queryKey: ['watch-tools'], queryFn: () => request<{ tools: { name: string; schema: unknown }[] }>('/watch-tools'), enabled: tab === 'watches' });

  async function act(path: string, body: unknown) {
    setWorking(true); setError('');
    try {
      const result = await post<Record<string, unknown>>(path, body);
      await Promise.all([qc.invalidateQueries({ queryKey: ['state'] }), qc.invalidateQueries({ queryKey: ['knowledge'] }), qc.invalidateQueries({ queryKey: ['permissions'] })]);
      return result;
    } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  }
  const callArguments = () => {
    const value = JSON.parse(argumentsText);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be a JSON object.');
    return value;
  };
  const configureWatch = async () => {
    try { await act('/watches', { title: name, projectId: projectId || undefined, tool, arguments: callArguments(), match, workflow: details, everyMinutes: Number(every) }); }
    catch (e) { setError((e as Error).message); }
  };
  const savePermission = async () => {
    try { await act('/permissions', { tool, arguments: callArguments(), expiresAt: Date.now() + 3_600_000 }); }
    catch (e) { setError((e as Error).message); }
  };
  const button = (label: string, action: () => unknown) => <button type="button" className="btn btn-quiet btn-sm" disabled={working} onClick={action}>{t(label)}</button>;

  return <Sheet title={t('Work')} wide onClose={onClose}>
    <nav className="work-tabs" aria-label={t('Work sections')}>{tabs.map((id) => <button key={id} className="btn btn-quiet btn-sm" aria-pressed={tab === id} onClick={() => setTab(id)}>{t(labels[id])}</button>)}</nav>
    {error && <p role="alert" className="is-error">{error}</p>}
    <label className="work-field"><span>{t('Project scope')}</span><select aria-label={t('Project scope')} value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">{t('All projects')}</option>{state.projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>

    {tab === 'projects' && <>
      <form className="work-form" onSubmit={(e) => { e.preventDefault(); void act('/projects', { name, objective, criteria, channel: channel && !state.projects?.some((p) => p.channel === channel) ? channel : undefined }).then((r) => { if (r?.id) { setProjectId(String(r.id)); onSelect(String(r.channel)); } }); }}>
        <Field label="Project name" value={name} onChange={setName} />
        <Field label="Objective" value={objective} onChange={setObjective} multiline />
        <Field label="Completion criteria" value={criteria} onChange={setCriteria} multiline />
        <button className="btn btn-send" disabled={working || !name.trim() || !objective.trim()}>{t('Create project')}</button>
      </form>
      {state.projects?.map((p) => <section className="work-card" key={p.id}>
        <h3>{p.name} · {t(p.status)}</h3><p>{p.objective}</p><p className="muted">{p.criteria}</p>
        <div className="work-actions">{button('Open conversation', () => { onSelect(p.channel); onClose(); })}{button('Edit project', () => { setProjectId(p.id); setObjective(p.objective); setCriteria(p.criteria); })}{button(p.status === 'active' ? 'Pause' : 'Resume', () => act('/projects/control', { id: p.id, action: p.status === 'active' ? 'pause' : 'resume' }))}{button('Complete project', () => act('/projects/control', { id: p.id, action: 'complete' }))}{button('Cancel project', () => act('/projects/control', { id: p.id, action: 'cancel' }))}</div>
      </section>)}
      {project && <ProjectEditor key={project.id} project={project} onSave={(patch) => act('/projects/update', { id: project.id, ...patch })} />}
    </>}

    {tab === 'tasks' && <>
      <form className="work-form" onSubmit={(e) => { e.preventDefault(); void act('/tasks', { title: name, details, criteria, projectId: projectId || undefined, device }); }}>
        <Field label="Task title" value={name} onChange={setName} /><Field label="Instructions" value={details} onChange={setDetails} multiline /><Field label="Completion criteria" value={criteria} onChange={setCriteria} multiline />
        <label className="work-field"><span>{t('Run on')}</span><select aria-label={t('Run on')} value={device} onChange={(e) => setDevice(e.target.value)}><option value="coordinator">{t('Coordinator')}</option><option value="desktop">{t('Desktop required')}</option></select></label>
        <button className="btn btn-send" disabled={working || !name.trim()}>{t('Add task')}</button>
      </form>
      {state.tasks.filter((task) => !projectId || task.projectId === projectId).map((task) => <section className="work-card" key={task.id}>
        <h3>{task.title} · {t(task.status)}</h3><p>{task.details}</p><p>{task.criteria}</p><p className="muted">{task.reason}</p>
        {task.deliverables?.map((file) => <p key={file}>{file}</p>)}
        <div className="work-actions">
          {['suggested', 'paused', 'interrupted', 'failed', 'waiting'].includes(task.status) && button(task.status === 'failed' ? 'Retry' : 'Resume', () => act('/tasks/control', { id: task.id, action: task.status === 'failed' ? 'retry' : 'resume' }))}
          {['running', 'queued', 'waiting'].includes(task.status) && button('Pause', () => act('/tasks/control', { id: task.id, action: 'pause' }))}
          {!['done', 'cancelled', 'dismissed'].includes(task.status) && button('Cancel', () => act('/tasks/control', { id: task.id, action: 'cancel' }))}
          {task.status === 'verification' && button('Confirm outcome', () => act('/tasks/done', { id: task.id }))}
          {task.status === 'done' && button('Save as workflow', () => act('/workflows/save', { id: task.id, name: task.title }))}
        </div>
        <details><summary>{t('Run history')}</summary>{state.runs?.filter((r) => r.taskId === task.id).map((r) => <p key={r.id}>{new Date(r.startedAt).toLocaleString()} · {t(r.status)} · {r.summary}</p>)}</details>
      </section>)}
    </>}

    {tab === 'knowledge' && <>
      <p className="muted">{t('Personal facts and third-party claims keep their sources. Only relevant or pinned entries enter prompts.')}</p>
      <Field label="Search knowledge" value={query} onChange={setQuery} />
      <form className="work-form" onSubmit={(e) => { e.preventDefault(); void act(factId ? '/knowledge/update' : '/knowledge', { ...(factId ? { id: factId } : {}), text: fact, kind, source, scope: projectId || 'personal' }).then((r) => { if (r) { setFact(''); setFactId(''); } }); }}>
        <Field label="Knowledge" value={fact} onChange={setFact} multiline /><Field label="Source" value={source} onChange={setSource} />
        <label className="work-field"><span>{t('Kind')}</span><select aria-label={t('Kind')} value={kind} onChange={(e) => setKind(e.target.value as Knowledge['kind'])}>{['fact', 'preference', 'commitment', 'decision', 'claim', 'summary'].map((k) => <option key={k} value={k}>{t(k)}</option>)}</select></label>
        <button className="btn btn-send" disabled={working || !fact.trim()}>{t(factId ? 'Save correction' : 'Save knowledge')}</button>
      </form>
      {knowledge.error && <p className="is-error">{knowledge.error.message}</p>}
      {knowledge.data?.knowledge.filter((k) => k.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!projectId || k.scope === projectId || k.scope === 'personal')).map((k) => <section className="work-card" key={k.id}><p>{k.text}</p><p className="muted">{t(k.kind)} · {k.source} · {new Date(k.updatedAt).toLocaleDateString()} · {k.scope === 'personal' ? t('Personal') : state.projects?.find((p) => p.id === k.scope)?.name ?? k.scope}</p><div className="work-actions">{button('Correct', () => { setFactId(k.id); setFact(k.text); setKind(k.kind); setSource(k.source); setProjectId(k.scope === 'personal' ? '' : k.scope); })}{button(k.pinned ? 'Unpin' : 'Pin', () => act('/knowledge/update', { id: k.id, pinned: !k.pinned }))}{button('Forget', () => act('/knowledge/forget', { id: k.id }))}</div></section>)}
    </>}

    {tab === 'watches' && <>
      <p className="muted">{t('Watches poll connected read tools. Matching new event IDs create one task each. External effects still require approval.')}</p>
      {!isPhone && <form className="work-form" onSubmit={(e) => { e.preventDefault(); void configureWatch(); }}>
        <Field label="Watch title" value={name} onChange={setName} />
        <label className="work-field"><span>{t('Read tool')}</span><select aria-label={t('Read tool')} value={tool} onChange={(e) => setTool(e.target.value)}><option value="">{t('Choose tool')}</option>{tools.data?.tools.map((tool) => <option key={tool.name}>{tool.name}</option>)}</select></label>
        {tools.error && <p className="is-error">{tools.error.message}</p>}
        {tool && <details><summary>{t('Tool input schema')}</summary><pre className="file-raw">{JSON.stringify(tools.data?.tools.find((t) => t.name === tool)?.schema, null, 2)}</pre></details>}
        <Field label="Exact arguments (JSON)" value={argumentsText} onChange={setArgumentsText} multiline /><Field label="Text to match" value={match} onChange={setMatch} /><Field label="Instructions for new events" value={details} onChange={setDetails} multiline /><Field label="Check every minutes" value={every} onChange={setEvery} type="number" />
        <button className="btn btn-send" disabled={working || !tool || !name.trim() || !details.trim()}>{t('Save watch (off)')}</button>
      </form>}
      {state.watches?.filter((w) => !projectId || w.projectId === projectId).map((w) => <section className="work-card" key={w.id}><h3>{w.title}</h3><p>{w.tool} · {w.everyMinutes} {t('minutes')} · {w.enabled ? t('On') : t('Off')}</p><p>{t('Last successful check')}: {w.lastSuccess ? new Date(w.lastSuccess).toLocaleString() : t('Never')}</p>{w.error && <p className="is-error">{w.error}</p>}{button(w.enabled ? 'Disable' : 'Enable', () => act('/watches/toggle', { id: w.id, enabled: !w.enabled }))}</section>)}
    </>}

    {tab === 'workflows' && <>
      <p className="muted">{t('Save confirmed tasks as workflows. Reusing a workflow creates a task for review and keeps approval boundaries.')}</p>
      <Field label="Inputs" value={inputs} onChange={setInputs} multiline />
      {state.workflows?.map((w) => <section className="work-card" key={w.id}><h3>{w.name}</h3><p>{w.instructions}</p><p>{w.criteria}</p>{button('Create task from workflow', () => act('/workflows/run', { id: w.id, projectId: projectId || undefined, inputs }))}</section>)}
    </>}

    {tab === 'receipts' && <>
      <p className="muted">{t('Uncertain outcomes block identical actions. Verify the external result before reconciling. Permissions match exact arguments and expire.')}</p>
      <Field label="Reconciliation evidence" value={reconciliation} onChange={setReconciliation} multiline />
      {state.receipts?.map((r) => <section className="work-card" key={r.id}><h3>{r.tool} · {t(r.status)}</h3><p className="muted">{new Date(r.startedAt).toLocaleString()}</p><details><summary>{t('Arguments and result')}</summary><pre className="file-raw">{JSON.stringify(r.arguments, null, 2)}{'\n\n'}{r.result}</pre></details><div className="work-actions">{r.status === 'uncertain' && reconciliation.trim() && <>{button('Confirmed externally', () => act('/receipts/reconcile', { id: r.id, status: 'confirmed', result: reconciliation }))}{button('Confirmed not executed', () => act('/receipts/reconcile', { id: r.id, status: 'failed', result: reconciliation }))}</>}{!isPhone && button('Use as permission template', () => { setTool(r.tool); setArgumentsText(JSON.stringify(r.arguments, null, 2)); })}</div></section>)}
      {!isPhone && <form className="work-form" onSubmit={(e) => { e.preventDefault(); void savePermission(); }}><Field label="Exact tool name" value={tool} onChange={setTool} /><Field label="Exact arguments (JSON)" value={argumentsText} onChange={setArgumentsText} multiline /><button className="btn btn-send" disabled={working || !tool}>{t('Allow these arguments for 1 hour')}</button></form>}
      {permissions.data?.permissions.map((p) => <section className="work-card" key={p.id}><p>{p.tool} · {new Date(p.expiresAt).toLocaleString()}</p><pre className="file-raw">{JSON.stringify(p.arguments, null, 2)}</pre>{!isPhone && button('Revoke', () => act('/permissions/delete', { id: p.id }))}</section>)}
    </>}

    {tab === 'provider' && <>
      <p className="muted">{t('Compatible endpoints run on the coordinator. Secrets stay in environment variables. Local model endpoints may use HTTP. No action is replayed through a fallback.')}</p>
      {!isPhone && <form className="work-form" onSubmit={(e) => { e.preventDefault(); void act('/provider', provider); }}>
        <Field label="Compatible API base URL (blank uses built-in providers)" value={provider.baseUrl} onChange={(baseUrl) => setProvider({ ...provider, baseUrl })} /><Field label="API key environment variable" value={provider.keyEnv} onChange={(keyEnv) => setProvider({ ...provider, keyEnv })} /><Field label="Chat model (blank uses Settings)" value={provider.chatModel} onChange={(chatModel) => setProvider({ ...provider, chatModel })} /><Field label="Task model (blank uses Settings)" value={provider.taskModel} onChange={(taskModel) => setProvider({ ...provider, taskModel })} /><Field label="Requests per turn" type="number" value={String(provider.maxRequests)} onChange={(v) => setProvider({ ...provider, maxRequests: Number(v) })} /><Field label="Reported token budget (0 disables)" type="number" value={String(provider.maxTokens)} onChange={(v) => setProvider({ ...provider, maxTokens: Number(v) })} />
        <button className="btn btn-send" disabled={working}>{t('Save provider')}</button>
      </form>}
      <p className="muted">{t('Usage is provider-reported. Missing token counts mean unavailable, not zero. Budgets apply per built-in agent turn.')}</p>
      {state.usage?.slice(-20).reverse().map((u, i) => <p key={i}>{new Date(u.at).toLocaleString()} · {u.model} · {t('input')}: {u.promptTokens ?? t('unavailable')} · {t('output')}: {u.completionTokens ?? t('unavailable')}</p>)}
    </>}

    {tab === 'history' && <><Field label="Search all conversations" value={query} onChange={setQuery} />{history.error && <p className="is-error">{history.error.message}</p>}{history.data?.messages.map((m) => <section className="work-card" key={m.id}><p className="muted">{new Date(m.ts).toLocaleString()} · {m.role} · {state.channels.find((c) => c.id === m.channel)?.name ?? t('Main')}</p><p>{m.text}</p></section>)}</>}
  </Sheet>;
}

function ProjectEditor({ project, onSave }: { project: Project; onSave: (patch: Partial<Project>) => unknown }) {
  const [objective, setObjective] = useState(project.objective);
  const [criteria, setCriteria] = useState(project.criteria);
  const [milestone, setMilestone] = useState('');
  const [decision, setDecision] = useState('');
  return <section className="work-card"><h3>{t('Edit project')}: {project.name}</h3><Field label="Objective" value={objective} onChange={setObjective} multiline /><Field label="Completion criteria" value={criteria} onChange={setCriteria} multiline /><button className="btn btn-quiet btn-sm" onClick={() => onSave({ objective, criteria })}>{t('Save')}</button>
    <h4>{t('Milestones')}</h4>{project.milestones.map((m, i) => <label className="work-check" key={i}><input type="checkbox" checked={m.done} onChange={() => onSave({ milestones: project.milestones.map((m, j) => j === i ? { ...m, done: !m.done } : m) })} />{m.title}</label>)}
    <form onSubmit={(e) => { e.preventDefault(); if (milestone.trim()) { onSave({ milestones: [...project.milestones, { title: milestone.trim(), done: false }] }); setMilestone(''); } }}><Field label="New milestone" value={milestone} onChange={setMilestone} /><button className="btn btn-quiet btn-sm">{t('Add milestone')}</button></form>
    <h4>{t('Decisions')}</h4>{project.decisions.map((d, i) => <p key={i}>{d}</p>)}<form onSubmit={(e) => { e.preventDefault(); if (decision.trim()) { onSave({ decisions: [...project.decisions, decision.trim()] }); setDecision(''); } }}><Field label="New decision" value={decision} onChange={setDecision} /><button className="btn btn-quiet btn-sm">{t('Save decision')}</button></form>
    <h4>{t('Linked files')}</h4>{project.files.map((file) => <p key={file}>{file}</p>)}
  </section>;
}
