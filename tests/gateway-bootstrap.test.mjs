import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('bootstrap uses public capabilities and works without an exported upstream package manifest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-gateway-bootstrap-'));
  const file = join(directory, 'bootstrap.json');
  const before = process.env.DSH_APP_SERVER_BOOTSTRAP_FILE;
  process.env.DSH_APP_SERVER_BOOTSTRAP_FILE = file;
  t.after(async () => {
    if (before === undefined) delete process.env.DSH_APP_SERVER_BOOTSTRAP_FILE;
    else process.env.DSH_APP_SERVER_BOOTSTRAP_FILE = before;
    await rm(directory, { recursive: true, force: true });
  });
  const plugin = join(directory, 'plugin.mjs');
  await copyFile(new URL('../packages/server/src/index.js', import.meta.url), plugin);
  const AppServer = await import(pathToFileURL(plugin));
  const ctx = {
    webServer: { port: 41234 },
    connection: {
      authenticatedUrl(base) { return `${base}?token=native-secret`; },
      fetch: { register() { return () => {}; } },
    },
    effect(effect) { effect(); },
  };
  await AppServer.apply(ctx);
  const bootstrap = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(bootstrap.url, 'http://127.0.0.1:41234/?token=native-secret');
  assert.equal(bootstrap.upstreamVersion, null);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(AppServer.apply(ctx), { code: 'EEXIST' });
});
