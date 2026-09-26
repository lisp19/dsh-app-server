/** Explicit first-use SSH fingerprint trust; changed keys are never auto-accepted. */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createHostKeyVerifier(directory, prompt) {
  const filename = join(directory, 'ssh-hosts.json');
  let queue = Promise.resolve();
  return async (host, signal) => {
    const pending = queue.then(async () => {
      signal.throwIfAborted();
      let keys;
      try { keys = JSON.parse(await readFile(filename, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; keys = {}; }
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid SSH trust file');
      const key = JSON.stringify([host.host.toLowerCase(), host.port]);
      const existing = keys[key];
      if (existing !== undefined) return existing === host.fingerprint;
      if (!await prompt(host, signal)) return false;
      signal.throwIfAborted();
      keys[key] = host.fingerprint;
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `ssh-hosts-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
        signal.throwIfAborted();
        await rename(temporary, filename);
      } finally { await unlink(temporary).catch(() => {}); }
      return true;
    });
    queue = pending.catch(() => {});
    return pending;
  };
}
