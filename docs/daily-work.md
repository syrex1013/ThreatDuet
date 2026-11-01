# Daily work

The **Work** button opens the project and execution workspace. All records stay under
`THREATDUET_HOME/data`; deliverables stay under `THREATDUET_HOME/workspace`.

## Projects and tasks

Create a project with an objective and completion criteria. Creating it from an ordinary channel
attaches that channel; otherwise Duet creates a new channel. Existing messages remain intact.
Projects retain milestones, decisions, linked files, task history and approvals.

Create a task in **Work → Tasks**, then start it. The sidebar also starts suggested tasks and
confirms results. Pause, cancel, resume and retry are available in Work. Pausing a project pauses
its tasks; resuming the project leaves individual tasks paused until reviewed.

Tasks remain running across continuation steps. Pending approvals keep them waiting. Reaching
the step limit pauses work. Provider errors and `<<FAILED>>` mark failure. Finished preparation
enters **verification**, where you compare the saved result with the completion criteria and
choose **Confirm outcome**. A model saying “done” never completes a task by itself.

After a restart, in-flight tasks become interrupted and in-flight action receipts become
uncertain. Nothing dispatches those actions again automatically. Review results and reconcile
uncertain receipts before resuming. Cancellation stops further steps; it cannot undo an action
that already reached an external service.

## Approvals and receipts

Natural-language proposals retain their existing approval cards. Their execution uses the built-in
agent so external writes can first show the exact tool name and arguments in a second approval.
Changing arguments requires a new approval. Local text-file replacements show a difference preview
and refuse execution if the file changed after that preview. Exact approved calls execute without another model
regenerating their arguments. Shell calls also bind the exact approved command at the local tool.

Receipts persist before dispatch and retain the returned confirmation or error. Lost responses,
empty responses, tool errors and unsuccessful shell exits require reconciliation. In
**Work → Receipts and permissions**, record evidence from the external service, then mark the
action confirmed or confirmed not executed. Do not infer non-execution from a timeout alone.

A permission grants one named tool with one exact JSON argument object until expiry. Argument
key order does not matter; recipients, content, paths, domains and every other value must match.
The UI offers one-hour permissions; the API allows expiry up to 30 days. Rules never bypass
tool availability, folder restrictions or protected workspace files. Rule creation and revocation
require the coordinator UI, not a paired phone. Existing explicit computer “Allow all” choices
still apply; the built-in agent records their effectful calls too.

## Knowledge and history

Knowledge entries include kind, source, scope, dates and pin state. Model-extracted memories are
claims; setup answers and user-edited entries can be facts or preferences. Retrieval uses local
word matching over personal knowledge and the current project, with pinned entries included.
Prompts receive at most 20 entries and 12,000 characters. Correcting or forgetting entries clears
loaded conversation sessions so old injected knowledge is not reused. Original conversation
messages remain searchable; forgetting knowledge does not erase the source conversation.

History no longer discards messages after 500 per channel. The live state stays bounded to 200
messages per channel; **Work → History** searches retained messages across all channels. Data
already discarded by older releases cannot be recovered by this change.

## Watches and workflows

Create a watch from a connected app's allowed read tool. Inspect its input schema, enter exact
JSON arguments, choose text to match and describe the preparation to perform. Watches start off;
enable one explicitly. The first successful check establishes a baseline. Subsequent unseen event
IDs that match create tasks. Each task and its source cursor persist together before dispatch.
Paused projects suspend their watches. Minimum polling interval is five minutes.

Arrays and `messages`, `items`, `results` or `data` arrays expose individual events. Other responses
are opaque events identified by a content hash. Providers without stable IDs need a query that
returns stable records; changing timestamps in opaque output can create additional events. Watches
use incremental cursors locally, not provider push subscriptions. Gmail push/Pub/Sub is not configured.

Meeting preparation, client follow-up and weekly project review are included as starter workflows.
Confirmed completed tasks can be saved as workflows. A workflow captures instructions, criteria
successful tool steps, expected outputs and required connection IDs. Reusing it with new inputs creates a suggested task for review.
Missing required connections block creation. A workflow never grants new permissions.

## Deliverables

**Made by Duet** accepts one document or screenshot per upload, up to 10 MB. Images preview in
the file viewer; supported text and HTML use the existing preview. Other binary formats remain
downloadable. Upload paths are unique, so uploads do not overwrite existing files.

Task checkpoints and opened files capture content-addressed revisions up to 10 MB each. Open
a file, choose a revision, compare changed content with the current file and restore it. Restore
first saves the current version, verifies the selected revision's SHA-256, then atomically replaces
the file. Workspace traversal, symlinks and protected configuration are excluded.

## Providers

The default model is `kilo/kilo-auto/free`. Existing model choices remain unchanged. NVIDIA NIM
requires your own `NVIDIA_API_KEY` or `NIM_API_KEY`; no credential ships in source. Any previously
distributed credential should be revoked in the provider account. Removing source code does not
revoke an issued key or remove it from existing Git history and releases.

In **Work → Provider and usage**, set an OpenAI-compatible API base URL, environment variable name,
chat model and task model. A local endpoint such as `http://127.0.0.1:11434/v1` is allowed. Set
the named environment variable on the coordinator process; the UI never accepts or returns its value.
Changing a custom endpoint sends model prompts and tool results to that endpoint.

The built-in agent streams text, assembles complete tool calls before dispatch, reports request
counts and displays token usage when supplied. Request budgets apply per agent turn, with a hard
ceiling of 40 steps. Token budgets use reported usage, including input tokens, and cap requested
completion tokens. A provider that omits usage cannot satisfy a token budget: the turn stops
before executing its tool calls. Without a token budget, missing counts display as unavailable.
Legacy Kilo server/CLI runs do not report usage through this interface. No automatic provider
fallback or uncertain-action replay is configured.

## Always-on coordinator

Run the existing Node server on one always-on computer. A lock prevents two coordinators using
the same data directory. Dead local-process locks recover on the next start. Locks owned by
another host, malformed locks and interrupted lock recovery require manual inspection.
Do not share a live data directory between hosts.

Build with the repository's existing toolchain:

```sh
bun install --frozen-lockfile
bun run build
THREATDUET_HOME="$HOME/.local/share/openduet" node dist/server/index.js
```

The local listener binds to loopback. For a server, open it through an SSH tunnel, complete setup,
then use the existing Phone settings to pair control surfaces. Keep the existing token protection
on the phone listener. The computer supplying cloud tools does not itself run the scheduler.

An example Linux systemd user service follows. Replace paths with the actual installation:

```ini
[Unit]
Description=OpenDuet personal coordinator
After=network-online.target

[Service]
WorkingDirectory=/opt/openduet
Environment=THREATDUET_HOME=%h/.local/share/openduet
Environment=THREATDUET_HEADLESS=1
EnvironmentFile=-%h/.config/openduet/provider.env
ExecStart=/usr/bin/node /opt/openduet/dist/server/index.js
Restart=on-failure
RestartSec=15

[Install]
WantedBy=default.target
```

`THREATDUET_HEADLESS=1` leaves tasks marked **Desktop required** waiting with a visible reason.
This release does not add a remote desktop worker transport: resume those tasks on a coordinator
running on the desktop. Existing cloud-computer tools remain usable from the server.

## Storage and interfaces

This release keeps the existing lowdb JSON format and atomic file replacement. Task records,
execution history, receipts, knowledge, cursors and project records share that state; revision
blobs live separately under `data/revisions`. Make backups of both `data` and `workspace` while
the coordinator is stopped. Retained history, receipts and revision blobs are not automatically
pruned. SQLite and embeddings are deferred to avoid an unverified cross-runtime data migration.

New API groups, mounted under `/api`, use the existing local/phone authentication:

- `/projects`, `/projects/update`, `/projects/control`
- `/tasks`, `/tasks/control`, `/tasks/done`, `/runs`
- `/knowledge`, `/knowledge/update`, `/knowledge/forget`, `/history`
- `/watch-tools`, `/watches`, `/watches/toggle`
- `/receipts`, `/receipts/reconcile`, `/permissions`, `/permissions/delete`
- `/workflows/save`, `/workflows/run`
- `/artifacts/revisions`, `/artifacts/revision`, `/artifacts/restore`, `/artifacts/download`, `/artifacts/upload`
- `/provider`

Configuration writes use POST JSON, except uploads, which use multipart `file`. Read endpoints
use GET. Exact argument permissions and watch enablement are restricted on paired phones.
