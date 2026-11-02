import fs from 'node:fs/promises';
import { PROVIDER_SECRETS_FILE } from './config.js';

type ProviderKey = 'KILO_API_KEY' | 'NVIDIA_API_KEY' | 'OPENAI_API_KEY';
type SafeStorage = typeof import('electron').safeStorage;

async function storage(): Promise<SafeStorage> {
  if (!process.versions.electron) throw new Error('Secure credential storage requires the desktop app.');
  const { safeStorage } = await import('electron');
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('System credential storage is unavailable.');
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Set up a system keyring before saving API keys.');
  }
  return safeStorage;
}

async function read(): Promise<Partial<Record<ProviderKey, string>>> {
  try {
    return JSON.parse(await fs.readFile(PROVIDER_SECRETS_FILE, 'utf8')) as Partial<Record<ProviderKey, string>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveProviderKeys(keys: Partial<Record<ProviderKey, string>>): Promise<void> {
  if (!Object.values(keys).some((key) => key?.trim())) return;
  const safeStorage = await storage();
  const saved = await read();
  for (const [name, key] of Object.entries(keys) as [ProviderKey, string | undefined][]) {
    if (key?.trim()) saved[name] = (await safeStorage.encryptStringAsync(key.trim())).toString('base64');
  }
  const temporary = `${PROVIDER_SECRETS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, PROVIDER_SECRETS_FILE);
  await fs.chmod(PROVIDER_SECRETS_FILE, 0o600);
}

export async function providerKey(name: string): Promise<string> {
  const fromEnvironment = process.env[name];
  if (fromEnvironment) return fromEnvironment;
  if (!['KILO_API_KEY', 'NVIDIA_API_KEY', 'NIM_API_KEY', 'OPENAI_API_KEY'].includes(name)) return '';
  const key = name === 'NIM_API_KEY' ? 'NVIDIA_API_KEY' : name as ProviderKey;
  const saved = (await read())[key];
  if (!saved) return '';
  return (await (await storage()).decryptStringAsync(Buffer.from(saved, 'base64'))).result;
}
