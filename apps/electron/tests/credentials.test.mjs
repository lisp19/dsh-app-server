import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore, connectionProfile } from '../src/credential-store.js';
import { createHostKeyVerifier } from '../src/ssh-host-keys.js';

// Test-only safeStorage substitute: these checks do not prove OS keyring behavior.
const storage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: value => Buffer.from(value),
  decryptString: value => value.toString(),
};
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-credentials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const secrets = { token: 'fixture-app-password', sshPassword: 'fixture-ssh-password', passphrase: '' };

test('remembered secrets round-trip, are endpoint-bound, and can be forgotten', async t => {
  const directory = await temporary(t);
  const store = createCredentialStore(directory, storage);
  const profile = connectionProfile({ url: 'https://server.example' });
  await store.save(profile, secrets, true);
  assert.equal((await store.read()).token, secrets.token);
  const filename = join(directory, 'connection.json');
  const persisted = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(persisted.token, undefined);
  assert.equal(typeof persisted.encryptedSecrets, 'string');
  await writeFile(filename, JSON.stringify({ ...persisted, url: 'https://other.example/' }));
  assert.equal((await store.read()).notice, 'credentialsRead');
  assert.equal((await store.read()).token, undefined);
  await store.forget();
  assert.equal((await store.read()).remember, false);
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).encryptedSecrets, undefined);
});

test('forget is ordered after concurrent save and a cancelled save cannot overwrite', async t => {
  const directory = await temporary(t);
  const store = createCredentialStore(directory, storage);
  const profile = connectionProfile({ url: 'https://server.example/' });
  await Promise.all([store.save(profile, secrets, true), store.forget()]);
  assert.equal((await store.read()).token, undefined);
  await assert.rejects(store.save(profile, secrets, true, () => { throw new Error('cancelled'); }));
  assert.equal((await store.read()).remember, false);
});

test('unavailable keyring refuses saving secrets; legacy URL-only settings still load', async t => {
  const directory = await temporary(t);
  const store = createCredentialStore(directory, { ...storage, isEncryptionAvailable: () => false });
  const profile = connectionProfile({ url: 'http://127.0.0.1:3080/' });
  await assert.rejects(store.save(profile, secrets, true), { code: 'secureStorage' });
  await store.save(profile, secrets, false);
  assert.equal((await store.read()).canSave, false);
  await writeFile(join(directory, 'connection.json'), JSON.stringify({ url: profile.url }));
  assert.equal((await store.read()).url, profile.url);
  if (process.platform === 'linux') {
    const fallback = createCredentialStore(directory, { ...storage, getSelectedStorageBackend: () => 'basic_text' });
    assert.equal(fallback.available(), false);
  }
});

test('SSH trust is explicit and pinned; changed key cannot prompt for replacement', async t => {
  const directory = await temporary(t);
  let prompts = 0;
  const verify = createHostKeyVerifier(directory, async (_host, signal) => { signal.throwIfAborted(); prompts++; return true; });
  const host = { host: 'host.example', port: 22, fingerprint: 'SHA256:fixture-first' };
  const signal = new AbortController().signal;
  assert.equal(await verify(host, signal), true);
  assert.equal(await verify(host, signal), true);
  assert.equal(await verify({ ...host, fingerprint: 'SHA256:fixture-changed' }, signal), false);
  assert.equal(prompts, 1);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(verify({ ...host, port: 2222 }, cancelled.signal));
});
