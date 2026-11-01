# OpenDuet

A proactive coworker in the style of Anthropic's Claude Duet. It runs locally and uses
NVIDIA NIM's free `nvidia/nemotron-3-ultra-550b-a55b` by default (model id `nim/nvidia/nemotron-3-ultra-550b-a55b`, built-in key, about 40 requests a minute), or any [Kilo Code](https://kilo.ai) model such as the free `kilo/kilo-auto/free`, so it costs nothing to run.

Like Claude Duet, it comes to you first:
- a morning brief, an evening report, and check-ins every few hours that interrupt only when something needs you
- background work on the tasks you hand it, and follow-ups it schedules for itself
- research, drafts and prepared work on its own
- **tasks it comes up with itself**, shown under "Duet's tasks" with *Do it* / *Dismiss*. In a
  conversation you started, Duet may begin its own preparation work right away (`<<TASK>>`).
  Ideas from background work (briefs, check-ins, follow-ups, routines, other tasks) are only
  suggested, because that work may have read untrusted mail or pages. At most 3 run at once and
  10 start per day. Anything that affects other people still comes back as a proposal.

**First launch** opens a short setup: language, a few lines about you and your work, your day
(brief, report, check-ins, quiet hours) and optional connections (apps, this computer, Duet's
computer). Nothing runs on a schedule until setup is finished or skipped; then Duet introduces
itself and comes up with its first tasks.

**Language:** Settings → Language switches the app and everything Duet writes (replies, briefs,
proposals, files) between English and Polish.

It **shows you exactly what it will do and waits for your approval** before it sends, pays,
signs, deletes or changes anything outside its workspace.

Approvals don't stall a bigger task. When one part needs your OK (say, an email draft), Duet
posts that proposal, pings you, and keeps working on the parts that don't depend on it, up to
its step limit. The proposal waits in "Needs you" until you approve or reject it.

## Quick start

Requires Node 22+ and the Kilo CLI (`npm i -g @kilocode/cli`, then `kilo auth`).

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4317
# or, while developing:
npm run dev          # API on :4317, UI on Vite's port with /api proxied
```

To connect apps (email, calendar, Slack, and so on), add MCP servers with `kilo mcp add`. Duet
uses every server Kilo has configured. To cut Duet off from one, name it in
Settings → Disconnected apps.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (vitest): reply parsing, policy guard, quiet hours, kilo event parser, phone-access auth |
| `npm run typecheck` | Type-checks the server and the web app |

## Desktop app (Electron)

```bash
npm run app            # build and run the desktop app
npm run dist:desktop   # package it: release/OpenDuet-<version>-arm64.dmg and .zip (unsigned)
```

The desktop app runs the same server inside Electron and keeps Duet working in the background:
- Closing the window hides it. Duet keeps running from the menu-bar icon, which shows how many approvals are waiting.
- The window can be resized and moved, and it remembers its size and position. **Compact window** (the arrows button in the top bar, View → Compact window, the tray menu, or Cmd/Ctrl+Shift+M) shrinks it to a small window that floats above the others; toggle again to get the full window back.
- The tray menu has Brief me now, Check in now, Open at login, Show workspace folder and Quit.
- Notifications are native, and clicking one opens the window. Approvals waiting also show as a Dock badge.
- Data lives in the OS app-data folder (`~/Library/Application Support/OpenDuet` on macOS) instead of the repo.
- At startup the app recovers your shell `PATH` (fix-path), so it finds `kilo` even when opened from Finder. If Kilo is missing, it says how to install it.

The build is ad-hoc signed but not notarized, so on other Macs Gatekeeper asks you to confirm the first launch (right-click the app, then Open). Notarizing needs an Apple Developer ID.

## Android app (Capacitor)

Kilo runs on your computer, so the phone app is a remote control for your desktop Duet: the thread, approvals, follow-ups, files, settings and notifications.

```bash
npm run android:apk    # android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Pairing:**
1. On the computer, open Settings, then Phone, and turn on phone access. This opens a second listener on port 4320 that only answers requests carrying a 256-bit pairing token.
2. Scan the QR code with the phone camera. It is an `openduet://pair?...` link that opens the app and pairs it. You can also type the address and code by hand.
3. "Unpair all phones" issues a new token. "Turn off phone access" closes the port.

**Notifications:** a background check (`@capacitor/background-runner`) asks your computer for news while the app is closed. Android runs it about every 15 minutes, not instantly. Instant push would need Firebase Cloud Messaging.

**What counts as seen:** the app tells the background check which replies you have looked at, and only while it is the active app, so a thread left open in the recent-apps list doesn't swallow notifications.

**Offline:** the app opens with the last thread it saw and refreshes in the foreground every 4 seconds. If the computer is unreachable it keeps showing that thread with a "Can't reach your computer" banner, a Retry button and a way back to pairing.

**Proxies:** the phone's HTTP stack honors the system proxy. On a network (or emulator) with a global proxy that can't reach the computer, requests time out after 15 seconds. If an emulator has a global proxy set (check with `adb shell settings get global http_proxy`), clear it or add the computer's address to `global_http_proxy_exclusion_list` for testing.

**Network:** use [Tailscale](https://tailscale.com) on both devices. Its `100.x` addresses are encrypted end to end and work away from home. On a plain Wi-Fi LAN the traffic is unencrypted HTTP, and anyone on that network could read the pairing code. The app allows cleartext HTTP for that reason (`res/xml/network_security_config.xml`), and Android backup is off so the pairing code never leaves the phone.

## Duet's computer (Instabox)

Like Claude Duet's virtual machine, Duet gets its own computer in the cloud with a browser, so it can look things up
and work while your laptop and phone are off. It uses an [Instabox](https://instabox.sh) machine made from the
`agent-browser` template (Debian, Chromium, a desktop).

**Connect it:** click the monitor icon in the top bar, paste an Instabox API key, pick a machine, and connect. OpenDuet wakes
the machine, installs a small browser driver under `/data/home/openduet/` on it (Playwright over the DevTools protocol),
starts Chromium on the machine's desktop and checks that it can load a page. Disconnecting never changes or deletes the machine.

**What Duet can do there:**

| Tool | Runs | Notes |
|---|---|---|
| `computer_status`, `computer_browser_read`, `computer_browser_screenshot`, `computer_read_file` | on its own | Reads the page that is already open, or a file in its working folder |
| `computer_browser_open` | on its own only if "Let Duet open web pages on its own" is on (Apps sheet) | Public http(s) pages only; never `file:`, `localhost` or addresses inside the machine's network |
| `computer_browser_click`, `_type`, `_press`, `computer_run`, `computer_write_file`, `computer_copy_to_workspace` | after you approve a proposal | Approved work runs in a fresh session. The cloud computer's commands never run on this Mac |

Duet's files live in `/data/workspace/openduet` on the machine and it cannot read or write outside it (symlinks resolved).
Pages and files it reads are marked as untrusted data, so text inside a web page can't give it orders.

## How Duet talks to Kilo

By default OpenDuet starts one headless `kilo serve` (loopback only, random port, random password) and sends each task over its HTTP API: the prompt travels in the request body, progress comes from the event stream, and the server stays warm between tasks. If the server can't start, or you pick "Command line" in Settings > Advanced, it runs `kilo run` per task with the prompt on stdin (Windows rejects line breaks in the arguments of a `.cmd` program, which is why the prompt is never an argument). App sign-in and listing still use the `kilo` CLI.

**No Kilo program (the usual Windows case):** OpenDuet checks for `kilo` once and, if it is missing, runs its own agent loop on Kilo's hosted gateway (`https://api.kilo.ai/api/gateway`, OpenAI-compatible; free models work without an account, about 200 requests an hour per IP; set `KILO_API_KEY` for more). It offers the same tools (workspace files, `webfetch`, skills, your apps over MCP, the Mac/PC tools, the cloud computer) and obeys the same permission file, so approvals work the same. Apps sign in through your browser with OAuth handled by OpenDuet (loopback port 19877); tokens are kept in the private data folder. Not available in this mode: Kilo's built-in `websearch` and `codesearch`. Pick "Kilo hosted API" in Settings to use it even when `kilo` is installed.

**Self-correction:** every run is a reason-act-observe loop: Duet sees each tool's result or error and decides the next step. In the built-in loop, the same call failing the same way is nudged once ("change the arguments or the approach") and stopped the third time, and an empty reply is nudged once. In every mode, a run that dies without an answer (crash, timeout, gateway down, a stuck step) is resumed once in its session, told what stopped it and asked to continue or say what blocks it. Approved actions are resumed only when the session survived, so nothing already done runs twice.

## Windows

Notifications are native Windows toasts. They need the Start-menu shortcut the installer creates
(it carries the app's ID, `tech.threatvector.openduet`), so a portable copy or `npm run app` may not show them.

`npm run dist:win` builds `release/OpenDuet-Setup-<version>.exe` (NSIS, x64; works from macOS when Wine is not needed for icon editing). `npm run release` builds macOS + Android always, then tries Windows and copies the `.exe` into `builds/` when that step succeeds.

- **Needs on the PC:** [git](https://git-scm.com) on `PATH`. The Kilo CLI is optional: without it OpenDuet uses Kilo's hosted API, and the app no longer shows a "needs the Kilo CLI" dialog at launch.
- **Unsigned:** the installer and app are not code-signed, so Windows SmartScreen warns on first run ("More info" > "Run anyway"). The exe has Electron's default icon because icon editing needs Wine or a Windows build machine.
- **Your PC panel:** files work the same (folders, symlink checks, deny-list for `AppData` credential stores, Brave data, `NTUSER.DAT`). Commands run in PowerShell, and only the exact commands in an approved proposal.
- **Browsers:** the cookie database is copied with Node's built-in sqlite. Chrome and Brave lock it while they run, so close the browser before the first use or press "Copy my sign-ins again". Newer Chromium builds can bind cookies to the original profile on Windows (app-bound encryption); the copy then opens signed out.
- **Testing on Windows:** `npm run smoke:task` runs a real task on the computer it is started on (the live model, `local_shell_run`, `local_files_list`, the real permission file) and fails if a tool errors or the answer is wrong; `.github/workflows/check.yml` runs the type check, the tests, that task and an Electron window screenshot on `windows-latest` and `macos-latest`. `npm run emulate:windows` runs on any computer: the process is made to believe it is Windows (platform, user, home, PATH), the app's own Windows prompt, brief and tool descriptions go to the live model, tools answer like a Windows PC, and it fails if the model sends a Unix command, a Unix path or a macOS tool. The installers were built on a Mac; the workflow is the Windows test, and it only runs while the GitHub account's Actions billing is in order (a private repo bills every minute).

## Your Mac (off by default)

The **Your Mac** panel lets Duet use this computer. Each part is a separate switch, and nothing is on until you turn it on.

| Part | On its own | After you approve a proposal |
|---|---|---|
| **Files** (`local_files_*`) | list, read and search the folders you add, or everything on the computer if you pick "Everything on this Mac/PC" | write a file in those folders |
| **Browser** (`local_browser_*`) | read, scroll and screenshot the open page; open a page only if "Let Duet open web pages on its own" is on | click, type, press keys, submit, all as you |
| **Commands** (`local_shell_run`) | nothing | run a command, and only the exact commands shown in the approved proposal |

- **Sign-ins (Brave, Chrome or Firefox):** pick whose sign-ins Duet browses with in the panel. For Brave and Chrome, OpenDuet copies the cookie database (a safe SQLite copy; the real profile is only read) into its private data folder and starts that browser out of sight on the copy. The browser opens the cookies with its own Keychain/DPAPI key, so Duet never sees a cookie value, only pages. Firefox keeps cookies unencrypted, so OpenDuet reads them (default profile, no container tabs) and loads them into Chrome or Brave, which it drives. The link to the browser is a pipe, not a network port. The copy is deleted when you turn the browser off, switch browser, press "Copy my sign-ins again", or quit.
- **Known limit:** some sites tie a session to the original browser. Google rejects a copied Chrome session (Brave's copy is accepted), and newer Chromium on Windows can bind cookies to the profile (app-bound encryption). Those sites open signed out.
- **Files:** paths are resolved through symlinks and must be inside an added folder. `~/.ssh`, `~/.aws`, `~/.gnupg`, Keychains, browser data, Claude/Codex/Kilo credentials and OpenDuet's own data folder stay off-limits even when a parent folder (such as your home) is added.
- **Everything on this Mac/PC:** a second mode under Files. Any folder (and on Windows any drive) your account can open is allowed; the deny-list above still holds, and a search without a folder starts in your home folder. On macOS, Documents, Desktop and Downloads trigger the system's own "allow access" prompt the first time, and Mail, Messages, Safari and Time Machine data stay closed until you add OpenDuet under System Settings > Privacy & Security > Full Disk Access; the panel shows a button that opens that page while access is missing. Windows and Linux need no grant.
- **Signing in:** Duet browses with a copy of your browser's sign-ins (Brave, Chrome or Firefox on macOS, Windows and Linux), always headless. When a site asks to sign in, Duet asks you to sign in in your own browser and then calls `local_browser_reload_signins` to pick up the new sign-in. On Windows, Chrome locks its cookie database while it is running; close Chrome before the first use or press "Copy my sign-ins again".
- **Auto mode (allow all):** a switch at the bottom of the panel. Everything turned on above then runs without a proposal: `local_files_write`, `local_shell_run` (any command), `local_browser_open`, `_click`, `_type`, `_press`. Duet is told to act directly and still not to delete, send or pay unasked, but only the prompt says so. Off by default.
- **Commands:** while a proposal runs, the shell tool refuses any command that is not in one of its ``` blocks. A paired phone cannot approve a proposal that contains commands; that needs this computer.
- **Risk you accept:** with files, Brave and commands connected, a malicious file, page or email could try to steer Duet. Duet treats what it reads as data, web fetching then needs approval, and anything that acts needs a click, but you should read each proposal before approving. Brave acts as you on every site you are signed in to.


**Watch it:** the Computer sheet shows the browser every few seconds. Clicking the picture clicks there, and you can type
and press keys. That is you acting, so it needs no approval; use it to sign in to a site for Duet. Looking at a sleeping
machine asks first, because waking it costs money. The machine pauses by itself after 30 idle minutes.

**Test it for real:** `npm run build && INSTABOX_API_KEY=ibk_... npm run smoke:computer` runs OpenDuet in a throwaway folder
against your actual Instabox machine (default name `dev`, or set `INSTABOX_MACHINE`) and checks: key, machine, setup, screenshot,
take-over, a real Duet turn that opens and reads a page, and that clicking waits for approval.

**Limits:** the live view is screenshots, not a VNC stream. A machine with Instabox Vault delivery on lets anything Duet runs
read your Vault secrets, so the app warns about it. Instabox charges apply while the machine runs.

## Release builds

```bash
npm run release   # tests, signed APK, macOS app, Windows installer when the win build succeeds; all in builds/
```

`builds/` then holds:

| File | What it is |
|---|---|
| `OpenDuet.app` | The desktop app (Apple silicon), ready to drag into Applications |
| `OpenDuet-<version>-arm64.dmg` | The same app as a disk image |
| `OpenDuet-Setup-<version>.exe` | Windows x64 installer (included when the win build succeeds) |
| `OpenDuet-<version>.apk` | The phone app, release-signed |
| `install-android.sh` | Lists `adb` devices, lets you pick one (or all), and installs the APK |
| `SHA256SUMS.txt` | Checksums for the shipped installers |

**Installing on Android:** run `./builds/install-android.sh`. It finds `adb` (PATH, `$ANDROID_HOME`, or the default SDK folders), shows every device with what to do about unauthorized or offline ones, and installs on the one you choose. If an older build signed with a different key is on the phone, it asks before uninstalling it, because that deletes the app's data and pairing.

**Android signing:** release builds are signed with `android/keystore/openduet-release.jks`, configured by `android/keystore.properties`. Both are git-ignored. Back them up somewhere safe: without them, no update will ever install over a phone that has this release, and users would have to uninstall and pair again.

**macOS signing:** the app is ad-hoc signed and hardened with Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no inspector flags, and code loads only from the integrity-checked `app.asar`. It isn't notarized; that needs an Apple Developer ID. On another Mac, open it the first time with right-click, then Open.

## The interface

Calm layered surfaces in ThreatVector white and red: a light-grey ground, white cards for anything you read or touch, and red reserved for what needs you. The same React UI runs in the browser, the desktop app and the phone app.
- **Status panel** (left on wide screens, a tappable strip with a bottom sheet on phones): Duet speaks first, for example "Two things need your approval." It lists what needs you, what's coming up (routines and Duet's own follow-ups, which you can cancel) and what's held for your next brief.
- **Timeline**: the thread by day on a time gutter, your messages in white cards, Duet's replies as plain markdown with the reticle mark. A "Now" line shows what Duet is doing this second ("reading acme-brief.md", "searching the web"), streamed from kilo's tool events.
- **Channels**: chips above the timeline (Main, `#sales`, `+`) split work by topic, on the phone too. Each channel keeps its own conversation context, so topics don't pollute each other, while Duet's memory is shared across all of them. Briefs, reports, check-ins and routines post to Main; "Needs you" lists approvals from every channel, tagged `#name`, and a red dot marks a channel with a reply you haven't opened. Closing a channel (×) moves its messages into Main. "Start a new thread" in Settings resets only the channel you are in.
- **Made by Duet** (folder button in the top bar, on the phone too): every file Duet wrote in its workspace, newest first, grouped by day, even after the message that made it has scrolled away. Read-only (`GET /api/files`); symlinks and Kilo's own config (`.kilo`, `kilo.json`, `AGENTS.md`, `.git`, ...) are never listed. Opening a file shows Markdown rendered, HTML as a sandboxed preview (no scripts, no network, separate origin; a Source toggle shows the code), and other text as-is. Select a passage and type in "Ask Duet to change this" to have Duet edit only that part; with no selection the request covers the whole file.
- **Approvals**: a white card framed by red corner brackets that lock on when it appears. Approve runs the action; Reject drops it.
- **Live**: the server pushes change events over SSE (`/api/events`); the UI refetches on each one and falls back to polling if the feed drops. Sending a message or approving shows at once and is rolled back if the server disagrees. A one-line banner appears while reconnecting, over whatever is already on screen.
- **Motion** (Motion for React): new entries rise in, the status headline crossfades, sheets spring open, approvals collapse into their resolved state. Everything respects `prefers-reduced-motion`.
- Type is Saira (bundled locally, no font CDN). Shapes follow one rule: cards and composer 16px, panels and inputs 12px, buttons 10px, chips pill. The wordmark keeps its sharp block.

## How the original products work (research)

**Claude Duet** (Anthropic, research preview, Oct 2026) is closed source. Its announcement
describes these features:
- A proactive agent with one ongoing thread, by typing or voice.
- A morning brief across connected apps.
- Checks every few hours, and messages you only when something needs attention. You can tell it what to watch and how often.
- Background tasks on its own VM, with a notification when a task finishes or needs review.
- Approval before it sends, pays, signs or deletes.
- Hard limits even with approval: no trading securities, no moving money between accounts.
- A sensitive-information classifier that blocks card numbers and government IDs.
- Carries over your memory and skills, and you can disconnect any app.

**Open Duet clones** follow the same pattern: an orchestrator drives an existing agent CLI as a
subprocess and adds scheduling, approvals and a UI on top.
- `Anil-matcha/open-duet` (FastAPI) spawns `claude --output-format stream-json`, `codex app-server` or ACP agents, with Docker computers.
- `CopilotKit/OpenDuet` (Hono + CopilotKit) adds triage, allow-once/always/refuse approvals and an audited gateway over AG-UI.
- `Studio1-OSS/OpenDuet` uses Next.js + Mastra.

**`claude-duet`** (npm) is a different product: two developers share one Claude Code session.
It spawns `claude -p --output-format stream-json`, uses WebRTC or WebSocket transport, and
encrypts with NaCl.

## How this version works

```
React UI ──HTTP──▶ Hono API ──▶ p-queue (one job at a time, your messages first) ──▶ execa: kilo run --format json
                     │                                                               │
                 croner tick (1/min)                                                 ├─ work:    --agent duet  (autonomous, fenced)
                 lowdb state.json                                                    └─ execute: --agent code --auto -s <same session>
```

Duet comes to you first. It does the legwork on its own and asks only before acting on the
outside world.

1. **Autonomous work.** Every chat message, brief, check-in and follow-up runs the custom
   `duet` agent, which the server defines in `workspace/kilo.json`. It may read, search, browse
   the web, use connector (MCP) tools whose names don't signal a side effect, and create or
   edit files in `workspace/`. That covers drafts, briefs, research and prototypes. It has no
   shell, no subagents, and no connector tools named like `*_send*`, `*_delete*`, `*_pay*`
   and so on.
2. **Multi-step tasks.** If a task needs more work, the agent ends a step with `<<CONTINUE>>`
   and is resumed automatically, up to 6 steps per request. You get a notification when it
   finishes.
3. **Proposals.** Anything that leaves the workspace or affects other people (send, reply,
   post, pay, sign, delete, book, change records) comes back as an `<<ACTIONS … ACTIONS>>`
   block with Approve and Reject buttons. An unclosed block still counts, so parsing errors
   fail toward asking you. A proposal that waits 3 hours gets one reminder.
4. **Guard.** Proposals are screened for the hard limits (trading securities, moving money
   between accounts), payment card numbers (Luhn check) and government IDs. A blocked
   proposal cannot be approved, and the check runs again at approval time.
5. **Execute.** Only after you approve does `kilo run --agent code --auto -s <session>` carry
   out the approved list.
6. **Triage.** Check-ins run every `checkEveryHours`, outside quiet hours. Duet decides what
   needs you:
   - `<<PRIORITY: high>>` is posted and notifies you.
   - `<<PRIORITY: low>>` is held in a digest and folded into the next morning brief.
   - `NOTHING` stays silent.
7. **Self-scheduled follow-ups.** `<<FOLLOWUP: 2026-11-02T09:00 | check if Bob replied>>`
   wakes Duet at that time to check and act. Upcoming follow-ups appear at the top of the
   thread and can be cancelled.
8. **Routines.** The morning brief runs at `briefAt` and the evening report at `reportAt`.
   A brief missed while the machine slept runs when it wakes.
   **Your own routines:** ask Duet for something recurring ("rebuild dashboard.html every
   weekday at 05:30", "recap unfinished drafts at 16:00") and it suggests one with
   `<<ROUTINE: 30 5 * * 1-5 | rebuild dashboard.html>>` (5-field cron, local time, at most
   hourly). Suggestions show under Coming up as "Suggested, off": tick On to start it, X to
   delete it. Only this computer can turn a routine on; a paired phone can only turn one off
   or delete it. Each run is an ordinary background turn, so anything leaving the workspace
   still comes back for your approval. Routines run at their time even in quiet hours.
9. **Context.** Every prompt carries `data/memory.md`, the pending approvals (so Duet doesn't
   propose them again) and its scheduled follow-ups. The agent adds to memory with
   `<<REMEMBER: …>>`. Chat continues one Kilo session; Settings → New thread starts fresh.

| Claude Duet feature | OpenDuet |
|---|---|
| Comes to you first: notices problems, prepares before you ask | Brief and check-in prompts plus autonomous `duet` agent; prep work lands in `workspace/` |
| Hand it tasks; it works out the steps in the background | Autonomous steps with `<<CONTINUE>>`, background queue |
| Notification when a task completes or needs review | node-notifier desktop notifications plus the browser Notification API |
| Morning brief | Daily at `briefAt`, including the held-back digest |
| Evening report | Daily at `reportAt`, built from today's thread |
| Checks every few hours, only messages when needed; tell it what and how often | Triage high/low/nothing, `checkEveryHours`, `focus`, quiet hours |
| One ongoing thread, typing or voice | Single session; voice in browser/Android (Electron has no SpeechRecognition keys) |
| Reads, drafts and prepares on its own; asks before send/pay/sign/delete | Fenced `duet` agent vs approved `code` execution |
| Off-limits even with approval | `policy.ts` guard |
| Sensitive-information classifier | Regex + Luhn screen (no classifier model) |
| Memory | `data/memory.md` |
| Connected apps, disconnect any | Kilo MCP servers, per-server deny |
| Own VM with a browser | Instabox `agent-browser` machine; Watch panel shows the screen (Claude Duet cannot yet) |
| Purchases via Link / Shop Pay | Apps → Payments: Link (`@stripe/link-cli` MCP) and Shop Pay (`https://mcp.shop.com/`); each purchase still needs your approval here and again in Link/Shop |
| 1Password sign-in | Not yet (also "coming soon" in Claude Duet) |
| Search past chats | `duet_search_chats` tool |
| Password stays out of chat | Watch panel password field never enters chat (still goes OpenDuet → Instabox → cloud browser) |
| iOS app | Android + desktop + web; no iOS build yet |

## Security notes

- The server binds to `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding) and requires
  an `x-duet: 1` header on every write (CSRF). Anyone with a shell on your machine can still use it.
- Every proposal is checked for sensitive information in two tiers (`src/server/policy.ts`).
  Never shared, even with approval: passwords and access keys (`sk-…`, `AKIA…`, `ghp_…`, private
  key blocks, `password: …`), card numbers, IBANs and government ID numbers. When a proposal is
  blocked for one of these, Duet is asked once to rewrite it without that information. Needs your consent: health
  and financial details are allowed, but the approval card warns that approving shares them.
  Both checks are regex screens, not classifiers.
- Connector tools are allowed for autonomous work unless their name contains a side-effect verb
  (see `SIDE_EFFECT_VERBS` in `src/server/store.ts`). This is a name screen, not a classifier.
  A write tool with a bland name would slip through, so review your MCP servers' tool names.
- File tools are confined to `workspace/` by `external_directory: deny`. The server writes
  this rule for the `duet` and `code` agents separately, because built-in agent rules override
  top-level ones. It also denies subagents (`task`), and it runs `git init` in `workspace/`,
  because Kilo measures "external" from the git root. Without that, an enclosing repo would
  put `data/` inside the sandbox. Kilo is also launched with `--dir` and `PWD` set to
  `workspace/`, because it resolves its project from `$PWD` rather than the process's working
  directory. All of this was verified against Kilo 7.8.18.
- **An approved task runs with `--auto` and a shell, and Kilo does not confine every shell
  path,** so treat approval as real execution on your machine. For real isolation, run the
  server inside a container or VM.
- The guard is a regex screen, not a classifier. It catches the obvious cases only.
- Free models follow the `<<ACTIONS>>`, `<<FOLLOWUP>>`, `<<CONTINUE>>` and `<<REMEMBER>>` markers
  imperfectly. A missed action block means nothing outside the workspace happens, because the
  autonomous agent cannot act outside it. A missed follow-up or memory note is lost; follow-ups
  you ask for explicitly are the most reliable.

## Layout

```
src/server/   server.ts (startServer) · index.ts (CLI) · api.ts (routes, zod) · app.ts (local app) · remote.ts (phone access)
              duet.ts (work/approve/execute, routines) · kilo.ts (execa runner, streamed progress) · parse.ts · policy.ts
              scheduler.ts (croner) · store.ts (lowdb) · events.ts (change feed) · notify.ts · listen.ts
src/electron/ main.ts (desktop shell: window, tray, native notifications, login item)
src/shared/   types.ts (shared by server and UI)
android/      Capacitor Android project (deep link, network config, background check)
capacitor.config.ts, web/public/runners/duet.js (phone background check)
scripts/icons.py  draws the app icons into build/ and assets/
web/          React + TanStack Query + Motion UI (Vite): live.ts (SSE/polling), status panel, timeline, approvals, sheets
data/         state.json, memory.md       (created at runtime, git-ignored)
workspace/    the agent's working dir + kilo.json sandbox config (created at runtime)
```
