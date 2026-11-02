# Private workspaces and browser sessions

Client installations now enroll against an HTTPS broker. Each installation stores its own identity, broker token, connectors, history, tasks, files and approvals inside its existing private home. Existing local data stays in place. Existing shared-machine records remain preserved but cannot execute through the distributed app. The embedded Instabox credential and automatic shared-machine connection were removed.

## Host prerequisites and rollout gate

The broker runs on the existing Instabox host, outside tenant sandboxes. Host administrators remain trusted. Install Docker with its iptables backend, Bun, a working gVisor `runsc` runtime and systemd. The broker needs host permission to install and verify firewall rules. Build the tenant image from this repository, then use its immutable digest:

```sh
bun install --frozen-lockfile
bun run build
docker build -f deploy/broker/Dockerfile -t openduet-tenant .
docker image inspect --format '{{.Id}}' openduet-tenant
```

Set `DUET_TENANT_IMAGE` to the returned `sha256:...` value or a registry image pinned with `@sha256:...`. Set `DUET_BROKER_HOME` to a private host-only directory. Set `DUET_BLOCKED_HOSTS` to the broker's public hostname and any public management hostnames, separated by commas. No provider credential belongs in this image or any tenant container.

The broker refuses to start until `DUET_LEGACY_CREDENTIAL_REVOKED=yes`. Set this only after revoking the previously distributed Instabox key in the administrator account. Removing the key from current source does not revoke copies in old applications, Git history or releases. Provider API keys cannot revoke themselves; account-side verification is required.

Host `dev` (`m_agqxfm7afyqbweuuwwu27i7b2q`) progress on 2026-11-02 with explicit approval:

- Installed Bun 1.4.4 and gVisor `runsc` 20261026.0; Docker registers `runsc` and `docker run --runtime=runsc hello-world` succeeded.
- Cleared Vault org/env secret delivery (`secrets=[]`, `envSecrets=[]`) and refreshed guest/proxy to applied empty state. The machine create-time `vault` boolean remains `true` (Instabox only accepts `vault:false` at create); recreate from snapshot with `vault:false` if the boolean itself must flip.
- Recovery snapshot `openduet-pre-broker-20261102` captured before bootstrap. Post-migrate snapshot creation hit repeated Instabox API 500s and was not confirmed; retry later.
- Built tenant image digest recorded on host at `/var/lib/openduet/tenant-image.digest`.
- Bootstrapped administrator tenant `da19ab83-d19c-41dc-be5d-7b589bfaa219`, provisioned its 1 GiB volume, migrated `/data/workspace/openduet` + `/data/home/openduet/profile` (367 files, cookies restored). One-time installation token is on-host only under `/var/lib/openduet/secrets/bootstrap.json`.
- Live two-volume `runsc` probes passed: non-root, no Docker socket, bounded disk (~1 GiB), no cross-tenant marker leak, no host `/var/lib/openduet` visibility, metadata/public endpoints unreachable under `--network=none`.
- Broker runs via `openduet-broker.service` on `127.0.0.1:4340` (Instabox.sh). Preflight, sandbox file ops, private browser `example.com`, egress CONNECT 200, and `broker:admin verify-migration` completed. Enrollment invites succeed. Per explicit operator choice the Instabox.sh CLI key was kept and `DUET_LEGACY_CREDENTIAL_REVOKED=yes` was set without account-side revocation. Vault org/env delivery remains cleared; create-time `vault` boolean is still `true`. Do not publish plain broker HTTP; put an authenticated HTTPS reverse proxy in front if clients need a public URL. Host idle auto-pause is 30 minutes.

## Administrator backup and restore

Stop legacy cloud automation and Chromium before copying. Take a provider snapshot as an additional recovery point. Keep the existing cloud workspace and profile untouched until browser login and restore have been accepted. Host-only administration requires the broker to be stopped, preventing concurrent registry writers.

```sh
bun run broker:admin bootstrap
```

Save the emitted administrator installation token privately. It is shown once. This is distinct from `DUET_BROKER_ADMIN_TOKEN`, the strong random token used for administrator HTTPS endpoints. Save the emitted tenant UUID and provision its bounded persistent disk:

```sh
sudo deploy/broker/provision-volume.sh ADMINISTRATOR_TENANT_UUID
```

The script creates a private 1 GiB ext4 image, a persistent systemd mount and a named Docker volume. It never formats an existing image. The mounted disk is owned by UID 1000. An unmounted or oversized filesystem fails runtime preflight.

Verified legacy sources on `dev` (read-only inventory, 2026-11-02):

- Browser profile with cookies: `/data/home/openduet/profile` (~105 MiB). Chromium singleton locks are present and must be excluded while Chromium is stopped.
- Driver package: `/data/home/openduet` (`duet-browser.mjs`, `VERSION`, `node_modules`). Do not treat this as model-readable workspace.
- Model workspace: `/data/workspace/openduet` exists but is empty. `/data/home/.config/chromium` only has crash reports and is not the active profile.
- Do not migrate the entire home directory; it contains `.ssh`, Docker state, and other credentials.

Restore the verified sources into the administrator volume. If the workspace source is empty, migrate the profile first and create an empty private workspace folder during restore verification:

```sh
sudo -E bun run broker:admin migrate \
  --workspace /data/workspace/openduet \
  --profile /data/home/openduet/profile \
  --backup-dir /var/lib/openduet/backups \
  --target /var/lib/openduet/tenants/ADMINISTRATOR_TENANT_UUID
```

This creates a private archive and receipt, excludes stale Chromium singleton locks, rejects escaping symlinks and special files, compares every restored file hash with the archive staging copy, and preserves original sources. The receipt contains the archive SHA256 and restore manifest. Failed restores leave source and backup intact; inspect partial target data before retrying. Root execution assigns restored files to the sandbox's UID 1000.

Administrator access is available before general enrollment so the administrator can verify login in the restored private browser. After that acceptance, stop the broker. Write a private evidence JSON file with these fields:

```json
{
  "tenantId": "ADMINISTRATOR_TENANT_UUID",
  "browserLoginVerified": true,
  "legacyCredentialRevoked": true,
  "verifiedAt": "ACTUAL_RECENT_ISO_TIMESTAMP",
  "notes": "Describe the live login and account-side revocation evidence."
}
```

Then enable enrollment:

```sh
bun run broker:admin verify-migration --receipt BACKUP_RECEIPT_PATH --evidence EVIDENCE_PATH
```

The command verifies the archive and restored workspace again. Browser profile changes caused by the accepted login are allowed. Evidence expires after 24 hours. This evidence is an administrator assertion, not an automated password-manager or encrypted-profile compatibility test. Do not assert success before observing it. Restore recovery uses the private archive; extract into a new empty administrator volume and recheck hashes and login, without overwriting the retained legacy source.

## HTTPS service and invites

On the Instabox.sh host, install `deploy/broker/openduet-broker.service` (EnvironmentFile points at `/var/lib/openduet/secrets/broker.env`) and enable it with systemd so the broker returns after idle resume. Otherwise run `bun run broker` with the variables above and a separate `DUET_BROKER_ADMIN_TOKEN` of at least 32 random characters. It listens only on `127.0.0.1:4340`; configure a host reverse proxy to that address and expose only authenticated HTTPS through Instabox's public port service or your TLS endpoint. Never publish the broker's plain HTTP listener, Docker API, tenant display or debugging ports.

Use the administrator bearer token against `POST /admin/invites` with a JSON body. Invites expire after 15 minutes and are single-use. Each enrollment creates a new tenant and installation token; clients cannot select tenant IDs. Provision the new UUID's private volume before its first operation. `GET /admin/installations` lists UUIDs and installation IDs without tokens. `POST /admin/revoke` accepts `{"installationId":"UUID"}` and rejects subsequent requests, including queued requests before dispatch.

In the app's Computer panel, enter the broker URL, private invite and name. For the administrator's existing workspace, select **Attach administrator workspace** and use its installation token. Phones pair to that installation's existing identity. The broker does not auto-wake a sleeping Instabox; the administrator must wake it.

One process owns the broker registry and global execution slot. Other installations see their own queue state. A second broker using the same home is refused. After an unclean host exit, inspect the PID in `broker.lock` and confirm no broker is running before removing a stale lock. Review uncertain external effects before resuming tasks; operations are not retried automatically.

## Isolation and browser behavior

Each tenant has its own bounded volume, persistent Chromium profile, display, temporary filesystem, PID namespace and internal Docker network. Sandboxes use gVisor, UID 1000, no capabilities, no new privileges, no host networking or host-directory mounts, and a read-only root. Browser limits: one CPU, 1536 MiB RAM, 256 processes, 128 MiB each for temporary files and shared memory. Shell jobs use disposable namespaces with 768 MiB RAM, 128 processes and a maximum 600-second lifetime. Job cleanup kills daemonized descendants while preserving the separate browser and data volume.

Public web access goes through a per-tenant proxy. It permits HTTP port 80 and HTTPS CONNECT port 443 to verified public IPv4 addresses, pins DNS results to connections, blocks private/metadata/provider/broker hosts and denies IPv6. IPv6-only sites and non-HTTP protocols are unsupported. No workload receives the Docker socket, another tenant's network, or a provider credential. Host INPUT and cross-bridge forwarding are explicitly blocked on each private tenant bridge; Docker internal networking alone is insufficient. Host administrators and the host kernel remain trusted. Tenant access fails closed when runtime, image, volume or container checks fail.

Credential prompts are transient inline cards owned by the task and channel. Passwords and OTPs travel through the dedicated input endpoint and bound browser field. A changed document, replaced input, changed field signature, cancellation or timeout requires fresh inspection. Snapshots omit form values; screenshots mask form fields. Use visible browser takeover for passkeys, consent, challenges and password-manager extensions. Automation pauses until control returns. Chat-origin autofill cannot guarantee another website's saved credentials will appear.

Closing or disabling local browsing preserves complete per-browser profiles. **Forget browser sessions** explicitly removes local profiles. Local and cloud profiles remain independent. Cookie transfer requires an explicit destination origin and copies only cookies available to that host; storage, passkeys and device keys are not copied. Sites may require a fresh login.

Model progress tools bind to the current run and task; they accept no arbitrary task ID. Objective metadata and activity remain separate. User-edited titles stay protected. Direct, API and CLI execution emit the same status contract. Latest task activity persists with bounded history. Direct sessions use atomic owned envelopes and validate complete tool-call/result pairs; damaged or unowned sessions start fresh without deleting old files. Reasoning metadata remains private and preserves original chunk order, as described by [OpenRouter's reasoning protocol](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx).

## Acceptance status

Local automated tests cover token isolation, revocation, invite reuse, queue behavior, takeover routing, credential prompt concurrency, cancellation, stale field binding, browser profile persistence and reasoning metadata. Chrome acceptance uses an isolated local fixture and fresh profiles, without importing personal website credentials.

Completed on `dev` (Instabox.sh host `m_agqxfm7afyqbweuuwwu27i7b2q`): `runsc`/Bun, Vault secret-delivery clear, administrator bootstrap + encrypted-profile migrate, live two-volume gVisor isolation, broker start (CLI key retained by operator choice), iptables/sudo + container-inspect + gVisor DNS Resolver fixes, preflight, sandbox write/read, private browser `example.com`, egress CONNECT 200, `broker:admin verify-migration`, enrollment invites open, and `openduet-broker.service` enabled. Idle auto-pause remains 1800s. Remaining optional: recreate with `vault:false`; authenticated HTTPS reverse-proxy (do not publish plain `:4340`); Windows/Android/1Password/Bitwarden/passkey acceptance.
