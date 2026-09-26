import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('distributed project does not pin or install upstream through its dependency graph', async () => {
  for (const name of ['package.json', 'packages/server/package.json', 'apps/electron/package.json']) {
    const manifest = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)));
    const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    assert.deepEqual(Object.keys(deps).filter(key => key.startsWith('@deepseek-ai/')), [], name);
  }
});

test('upstream source patch assets have been removed', async () => {
  for (const name of ['remote-settings.patch', 'fixed-login-password.patch']) {
    await assert.rejects(access(new URL(`../compat/${name}`, import.meta.url)), { code: 'ENOENT' });
  }
});
