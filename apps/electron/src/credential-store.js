/** Persist the last connection with OS-encrypted, endpoint-bound credentials. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConnectionError, parseServerURL } from './security.js';
import { validateSSH } from './ssh-tunnel.js';

/** Strip secrets and validate the settings renderer's connection description. */
export function connectionProfile(input) {
  const url = parseServerURL(input?.url).href;
  const transport = input?.transport ?? 'direct';
  if (!['direct', 'ssh'].includes(transport)) throw new ConnectionError('sshConfig');
  if (transport === 'ssh' && new URL(url).protocol !== 'http:') throw new ConnectionError('sshConfig');
  return { url, transport, ...(transport === 'ssh' ? { ssh: validateSSH(input.ssh) } : {}) };
}

/** Main-process store; only the trusted settings page receives decrypted values. */
export function createCredentialStore(directory, safeStorage) {
  const filename = join(directory, 'connection.json');
  let queue = Promise.resolve();
  const available = () => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
  async function read() {
    let record;
    try { record = JSON.parse(await readFile(filename, 'utf8')); }
    catch (error) { return { canSave: available(), ...(error.code === 'ENOENT' ? {} : { notice: 'settings' }) }; }
    let profile;
    try { profile = connectionProfile(record); }
    catch { return { canSave: available(), notice: 'settings' }; }
    const result = { ...profile, remember: record.remember === true, canSave: available() };
    if (!record.encryptedSecrets) return result;
    if (!available()) return { ...result, notice: 'secureStorage' };
    try {
      const envelope = JSON.parse(safeStorage.decryptString(Buffer.from(record.encryptedSecrets, 'base64')));
      if (JSON.stringify(envelope.profile) !== JSON.stringify(profile)) throw new Error('Credential destination changed');
      const secrets = envelope.secrets;
      if (!secrets || ['token', 'sshPassword', 'passphrase'].some(key => typeof secrets[key] !== 'string' || secrets[key].length > 8192)) throw new Error('Invalid encrypted credentials');
      return { ...result, ...secrets };
    } catch { return { ...result, notice: 'credentialsRead' }; }
  }
  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  async function persist(profile, secrets, remember, assertCurrent = () => {}) {
      assertCurrent();
      const record = { version: 2, ...profile, remember };
      if (remember) {
        if (!available()) throw new ConnectionError('secureStorage');
        record.encryptedSecrets = safeStorage.encryptString(JSON.stringify({ profile, secrets })).toString('base64');
      }
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `connection-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(record) + '\n', { mode: 0o600 });
        assertCurrent();
        await rename(temporary, filename);
      } finally { await unlink(temporary).catch(() => {}); }
  }
  function save(profile, secrets, remember, assertCurrent) {
    return enqueue(() => persist(profile, secrets, remember, assertCurrent));
  }
  function forget() {
    return enqueue(async () => {
      const record = await read();
      if (record.url) await persist(connectionProfile(record), {}, false);
      else await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
    });
  }
  return { read, save, forget, available };
}
