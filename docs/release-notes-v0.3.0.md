# ThreatDuet 0.3.0

OpenDuet now turns ongoing conversations into persistent work. Create projects with objectives,
milestones, decisions and completion criteria. Pause, cancel, resume or retry tasks. Pending
approvals and interrupted runs remain visible; task completion requires a saved result or external
receipt and user confirmation.

## Daily work

- Search retained conversation history and source-linked personal or project knowledge. Correct,
  pin or forget knowledge without reusing stale conversation sessions.
- Poll connected read tools through explicitly enabled watches. New matching event IDs create one
  task; the first successful poll establishes a baseline.
- Reuse meeting preparation, client follow-up and weekly review workflows. Save confirmed tasks as
  additional workflows.
- Upload documents and screenshots, inspect revision differences, restore prior versions and
  download deliverables.
- Review exact external tool arguments before execution. Expiring permissions bind to exact
  arguments. Durable receipts flag uncertain outcomes and block replay until reconciliation.
- Configure compatible providers, separate chat and task models, stream replies and enforce
  provider-reported usage budgets.
- Run one coordinator per data directory. Headless desktop-only tasks wait for explicit desktop
  execution.

The default model is `kilo/kilo-auto/free`. NVIDIA NIM now requires your own `NVIDIA_API_KEY` or
`NIM_API_KEY`. Any previously distributed provider credential still requires account-side
revocation.

## Validation

- Production build passed.
- 179 regression tests passed.
- Desktop and mobile browser acceptance passed, including project creation, knowledge correction,
  upload, revision comparison and restore.
- Live providers, connected accounts, packaged app installs and remote desktop worker transport
  remain unverified or deferred.
