import { execa } from 'execa';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Sandbox } from './server.js';
import type { Tenant } from './registry.js';

const id = (tenant: Tenant) => {
  if (!z.uuid().safeParse(tenant.id).success) throw new Error('Invalid authenticated tenant.');
  return `duet-${tenant.id}`;
};
const driver = '/opt/duet/duet-browser.mjs';
const work = '/data/workspace/threatduet';
const run = async (args: string[], input?: string, timeout = 30_000) => {
  try { return await execa('docker', args, { input, timeout, maxBuffer: 1_100_000, reject: true }); }
  catch { throw new Error('Sandbox command failed. Administrator must inspect container health.'); }
};

/** Host-only Docker adapter. No host command, mount, network, image, or tenant selector comes from requests. */
export class DockerSandbox implements Sandbox {
  private checks = new Map<string, number>();
  private passed = new Map<string, number>();
  constructor(private readonly image: string, private readonly blockedHosts: string[], private readonly volumeBase = '/var/lib/openduet/tenants') {}
  async preflight(tenant: Tenant) {
    let stage = 'Docker daemon';
    // A pass is reused for seconds so one request (route, ensure) and status polls don't each respawn every check.
    if ((this.passed.get(tenant.id) ?? 0) > Date.now()) return { available: true, reason: null };
    this.passed.delete(tenant.id);
    try {
      if (!/(?:@|^)sha256:[a-f0-9]{64}$/.test(this.image)) throw new Error('Tenant image must be pinned by SHA256 digest.');
      if (!this.blockedHosts.length) throw new Error('Broker public hostname must be blocked by the egress proxy.');
      const info = JSON.parse((await run(['info', '--format', '{{json .}}'])).stdout);
      if (!info.Runtimes?.runsc) throw new Error('gVisor runsc runtime unavailable; cloud shell, browser and files disabled.');
      stage = 'host firewall (iptables Docker backend)';
      await execa('sudo', ['-n', 'iptables', '-w', '5', '-S', 'DOCKER-USER'], { timeout: 10_000 });
      const name = id(tenant);
      stage = 'private quota-backed persistent volume';
      const volume = JSON.parse((await run(['volume', 'inspect', `${name}-data`])).stdout)[0];
      // Administrator provisions a dedicated bounded filesystem, never an unbounded shared Docker directory.
      if (!volume.Labels?.['openduet.quota-bytes'] || Number(volume.Labels['openduet.quota-bytes']) > 2_147_483_648 || Number(volume.Labels['openduet.quota-bytes']) < 67_108_864) throw new Error('Private persistent volume with verified disk limit required.');
      if (volume.Labels['openduet.tenant'] !== tenant.id) throw new Error('Persistent volume owner does not match authenticated tenant.');
      const directory = path.join(this.volumeBase, tenant.id);
      if (volume.Options?.device !== directory || await fs.realpath(directory) !== directory) throw new Error('Volume is not the canonical private tenant mount.');
      const mounted = await fs.stat(directory);
      if (mounted.dev === (await fs.stat(this.volumeBase)).dev || mounted.uid !== 1000 || (mounted.mode & 0o077) !== 0) throw new Error('Tenant disk is unmounted or has unsafe ownership.');
      for (const sibling of await fs.readdir(this.volumeBase)) {
        if (sibling !== tenant.id && z.uuid().safeParse(sibling).success && (await fs.stat(path.join(this.volumeBase, sibling))).dev === mounted.dev) throw new Error('Two tenants share a filesystem.');
      }
      stage = 'pinned tenant image';
      await run(['image', 'inspect', this.image]);
      if ((this.checks.get(tenant.id) ?? 0) < Date.now() - 30_000) {
        stage = 'live gVisor runtime and disk-limit probe';
        await run(['run', '--rm', '--runtime=runsc', '--user=1000:1000', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--pids-limit=32', '--mount', `type=volume,source=${name}-data,target=/data`, '--entrypoint=node', this.image, '-e', "const f=require('fs');if(process.getuid()===0)process.exit(1);const s=f.statfsSync('/data');if(s.blocks*s.bsize>2147483648||s.blocks*s.bsize<67108864)process.exit(2);const p='/data/.isolation-probe-'+process.pid;f.writeFileSync(p,'probe',{flag:'wx'});f.unlinkSync(p);if(f.existsSync('/var/run/docker.sock'))process.exit(3);"]);
        this.checks.set(tenant.id, Date.now());
      }
      this.passed.set(tenant.id, Date.now() + 5_000);
      return { available: true, reason: null };
    } catch (error) { return { available: false, reason: `Isolation preflight failed (${stage}): ${(error as Error).message}` }; }
  }
  private async protectHost(network: any) {
    if (network.Driver !== 'bridge' || !/^[a-f0-9]{64}$/.test(network.Id)) throw new Error('Unsupported tenant network.');
    const bridge = network.Options?.['com.docker.network.bridge.name'] || `br-${network.Id.slice(0, 12)}`;
    if (!/^[a-zA-Z0-9_-]{1,15}$/.test(bridge)) throw new Error('Invalid private bridge.');
    // Docker internal networks still reach their host gateway. Deny host INPUT and cross-bridge forwarding explicitly.
    for (const rule of [['INPUT', '-i', bridge, '-j', 'DROP'], ['DOCKER-USER', '-i', bridge, '!', '-o', bridge, '-j', 'DROP']]) {
      const check = await execa('sudo', ['-n', 'iptables', '-w', '5', '-C', ...rule], { reject: false });
      if (check.exitCode !== 0) await execa('sudo', ['-n', 'iptables', '-w', '5', '-I', ...rule]);
    }
  }
  private async ensure(tenant: Tenant) {
    const check = await this.preflight(tenant);
    if (!check.available) throw new Error(check.reason!);
    const name = id(tenant);
    try { await run(['network', 'inspect', name]); }
    catch { await run(['network', 'create', '--internal', '--ipv6=false', '--label', `openduet.tenant=${tenant.id}`, name]); }
    const network = JSON.parse((await run(['network', 'inspect', name])).stdout)[0];
    if (!network.Internal || network.EnableIPv6 || network.Labels?.['openduet.tenant'] !== tenant.id) throw new Error('Private network isolation failed.');
    await this.protectHost(network);
    try { await run(['network', 'inspect', 'duet-egress']); }
    catch { await run(['network', 'create', 'duet-egress']); }
    try { await run(['inspect', '--type', 'container', `${name}-proxy`]); }
    catch {
      await run(['create', '--name', `${name}-proxy`, '--label', `openduet.tenant=${tenant.id}`, '--user', '1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--runtime=runsc', '--pids-limit=64', '--memory=128m', '--cpus=0.25', '--network', name, '--network-alias', 'egress', '--dns', '1.1.1.1', '--dns', '8.8.8.8', '--env', `DUET_BLOCKED_HOSTS=${this.blockedHosts.join(',')}`, '--entrypoint', 'node', this.image, '/opt/duet/egress.mjs']);
      await run(['network', 'connect', 'duet-egress', `${name}-proxy`]);
    }
    await run(['start', `${name}-proxy`]);
    let proxy = JSON.parse((await run(['inspect', '--type', 'container', `${name}-proxy`])).stdout)[0];
    const dns = proxy.HostConfig.Dns ?? [];
    if (!dns.includes('1.1.1.1') || !dns.includes('8.8.8.8')) {
      await run(['rm', '-f', `${name}-proxy`]);
      await run(['create', '--name', `${name}-proxy`, '--label', `openduet.tenant=${tenant.id}`, '--user', '1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--runtime=runsc', '--pids-limit=64', '--memory=128m', '--cpus=0.25', '--network', name, '--network-alias', 'egress', '--dns', '1.1.1.1', '--dns', '8.8.8.8', '--env', `DUET_BLOCKED_HOSTS=${this.blockedHosts.join(',')}`, '--entrypoint', 'node', this.image, '/opt/duet/egress.mjs']);
      await run(['network', 'connect', 'duet-egress', `${name}-proxy`]);
      await run(['start', `${name}-proxy`]);
      proxy = JSON.parse((await run(['inspect', '--type', 'container', `${name}-proxy`])).stdout)[0];
    }
    if (proxy.Config.Image !== this.image || proxy.Config.User !== '1000:1000' || proxy.HostConfig.Runtime !== 'runsc' || proxy.HostConfig.Privileged || !proxy.HostConfig.ReadonlyRootfs || proxy.Mounts?.length || !proxy.HostConfig.CapDrop?.includes('ALL') || !proxy.HostConfig.SecurityOpt?.includes('no-new-privileges') || Object.keys(proxy.HostConfig.PortBindings ?? {}).length || Object.keys(proxy.NetworkSettings.Networks).sort().join(',') !== [name, 'duet-egress'].sort().join(',')) throw new Error('Private egress proxy isolation failed.');
    const egressIp = proxy.NetworkSettings.Networks?.[name]?.IPAddress;
    if (!egressIp || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(egressIp)) throw new Error('Private egress proxy address missing.');
    try { await run(['inspect', '--type', 'container', name]); }
    catch {
      // gVisor does not reliably resolve Docker network aliases; pin egress by IP.
      await run(['create', '--name', name, '--label', `openduet.tenant=${tenant.id}`, '--runtime=runsc', '--user=1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1536m', '--memory-swap=1536m', '--cpus=1', '--network', name, '--add-host', `egress:${egressIp}`, '--mount', `type=volume,source=${name}-data,target=/data`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=134217728,mode=1777', '--tmpfs', '/dev/shm:rw,nosuid,nodev,size=134217728', '--env', 'HOME=/data/home', '--env', 'DISPLAY=:1', '--env', 'DUET_GVISOR=1', '--env', 'HTTP_PROXY=http://egress:3128', '--env', 'HTTPS_PROXY=http://egress:3128', '--env', 'http_proxy=http://egress:3128', '--env', 'https_proxy=http://egress:3128', '--env', 'NO_PROXY=localhost,127.0.0.1', '--env', 'no_proxy=localhost,127.0.0.1', '--env', 'CHROMIUM_PROXY=http://egress:3128', this.image]);
    }
    await run(['start', name]);
    let container = JSON.parse((await run(['inspect', '--type', 'container', name])).stdout)[0];
    const hosts = container.HostConfig.ExtraHosts ?? [];
    if (!hosts.includes(`egress:${egressIp}`)) {
      await run(['rm', '-f', name]);
      await run(['create', '--name', name, '--label', `openduet.tenant=${tenant.id}`, '--runtime=runsc', '--user=1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1536m', '--memory-swap=1536m', '--cpus=1', '--network', name, '--add-host', `egress:${egressIp}`, '--mount', `type=volume,source=${name}-data,target=/data`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=134217728,mode=1777', '--tmpfs', '/dev/shm:rw,nosuid,nodev,size=134217728', '--env', 'HOME=/data/home', '--env', 'DISPLAY=:1', '--env', 'DUET_GVISOR=1', '--env', 'HTTP_PROXY=http://egress:3128', '--env', 'HTTPS_PROXY=http://egress:3128', '--env', 'http_proxy=http://egress:3128', '--env', 'https_proxy=http://egress:3128', '--env', 'NO_PROXY=localhost,127.0.0.1', '--env', 'no_proxy=localhost,127.0.0.1', '--env', 'CHROMIUM_PROXY=http://egress:3128', this.image]);
      await run(['start', name]);
      container = JSON.parse((await run(['inspect', '--type', 'container', name])).stdout)[0];
    }
    const host = container.HostConfig;
    if (container.Config.Image !== this.image) throw new Error('Tenant image changed; administrator must review before restarting.');
    if (host.Runtime !== 'runsc' || host.Privileged || host.NetworkMode !== name || host.PidMode || host.UsernsMode === 'host' || host.IpcMode === 'host' || host.Binds?.length || container.Config.User !== '1000:1000' || !host.ReadonlyRootfs || !host.CapDrop?.includes('ALL') || !host.SecurityOpt?.includes('no-new-privileges') || host.PidsLimit !== 256 || host.Memory !== 1_610_612_736 || host.NanoCpus !== 1_000_000_000 || container.Mounts.filter((m: any) => m.Type !== 'tmpfs').some((m: any) => m.Type !== 'volume' || m.Name !== `${name}-data` || m.Destination !== '/data') || Object.keys(container.NetworkSettings.Networks).some((n) => n !== name) || Object.keys(host.PortBindings ?? {}).length) throw new Error('Tenant container isolation check failed.');
    const stat = await run(['exec', name, 'node', '-e', "const f=require('fs');const s=f.statfsSync('/data');if(s.blocks*s.bsize>2147483648)process.exit(1);f.mkdirSync('/data/workspace/threatduet',{recursive:true});f.mkdirSync('/data/home',{recursive:true});"]);
    void stat;
    return name;
  }
  async execute(tenant: Tenant, operation: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const name = await this.ensure(tenant);
    if (operation === 'browser') {
      const input = z.object({ action: z.enum(['start', 'open', 'read', 'screenshot', 'click', 'type', 'press', 'cookies', 'inspect-input', 'fill-input']), args: z.record(z.string(), z.unknown()).default({}) }).strict().parse(args);
      const out = await run(['exec', '-i', name, 'timeout', '-k', '2', '90', 'node', driver, input.action, '-'], JSON.stringify(input.args), 100_000);
      const result = JSON.parse(out.stdout.trim().split('\n').at(-1) ?? '{}');
      if (!result.ok) throw new Error('Private browser action failed. Inspect the page before retrying.');
      return result;
    }
    if (operation === 'exec') {
      const input = z.object({ cmd: z.string().min(1).max(20_000), timeoutSeconds: z.number().int().min(1).max(600).default(120) }).strict().parse(args);
      // A separate disposable process namespace contains even daemonized descendants. Persistent browser stays independent.
      const job = `${name}-job`;
      const kill = () => { void run(['kill', job]).catch(() => undefined); };
      signal?.throwIfAborted();
      const timer = setTimeout(kill, (input.timeoutSeconds + 2) * 1000);
      signal?.addEventListener('abort', kill, { once: true });
      try {
        const proxy = JSON.parse((await run(['inspect', '--type', 'container', `${name}-proxy`])).stdout)[0];
      const egressIp = proxy.NetworkSettings.Networks?.[name]?.IPAddress;
      if (!egressIp) throw new Error('Private egress proxy address missing.');
      const result = await execa('docker', ['run', '--rm', '--name', job, '--runtime=runsc', '--user=1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--memory-swap=768m', '--cpus=1', '--network', name, '--add-host', `egress:${egressIp}`, '--mount', `type=volume,source=${name}-data,target=/data`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=134217728,mode=1777', '--env', 'HOME=/data/home', '--env', 'HTTP_PROXY=http://egress:3128', '--env', 'HTTPS_PROXY=http://egress:3128', '--env', 'http_proxy=http://egress:3128', '--env', 'https_proxy=http://egress:3128', '--env', 'NO_PROXY=localhost,127.0.0.1', '--env', 'no_proxy=localhost,127.0.0.1', '--workdir', work, '--entrypoint', 'timeout', this.image, '-k', '2', `${input.timeoutSeconds}`, 'bash', '-lc', input.cmd], { timeout: (input.timeoutSeconds + 10) * 1000, maxBuffer: 1_048_576, reject: false });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timedOut: result.exitCode === 124 || result.exitCode === 137 };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', kill);
        // Ensure no command namespace survives a CLI disconnect or output-limit failure.
        await run(['rm', '-f', job]).catch(() => undefined);
      }
    }
    const input = z.object({ path: z.string().min(1).max(2000), content: z.string().max(700_000).optional() }).strict().parse(args);
    // File operations run inside the same sandbox and revalidate symlinks there. No host filesystem endpoint exists.
    const program = `const fs=require('fs'),p=require('path');const a=JSON.parse(fs.readFileSync(0,'utf8'));const root='${work}';let target=p.resolve(root,a.path);if(target!==root&&!target.startsWith(root+'/'))throw Error('Outside workspace');let probe=target;while(!fs.existsSync(probe)){const next=p.dirname(probe);if(next===probe)throw Error('Invalid path');probe=next}const real=fs.realpathSync(probe);if(real!==root&&!real.startsWith(root+'/'))throw Error('Outside workspace');const op=process.argv[1];if(op==='writeFile'){fs.mkdirSync(p.dirname(target),{recursive:true});fs.writeFileSync(target,a.content??'');console.log(JSON.stringify({bytes:Buffer.byteLength(a.content??'')}))}else if(fs.statSync(target).isDirectory()){console.log(JSON.stringify({entries:fs.readdirSync(target,{withFileTypes:true}).map(e=>({name:e.name,type:e.isDirectory()?'dir':'file'}))}))}else{if(fs.statSync(target).size>700000)throw Error('File too large');const data=fs.readFileSync(target);console.log(JSON.stringify(op==='copyFile'?{base64:data.toString('base64')}:{content:data.toString('utf8')}))}`;
    const result = await run(['exec', '-i', name, 'node', '-e', program, operation], JSON.stringify(input));
    return JSON.parse(result.stdout);
  }
}
