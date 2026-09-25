import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import * as AppServer from '../packages/server/src/index.js';

test('real Host authenticates discovery and unload removes its route', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-app-server-test-'));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await ctx.plugin(Credentials, { path: join(directory, 'credentials.yaml'), watch: false }).await();
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await();
  await ctx.plugin(Connection).await();
  const plugin = ctx.plugin(AppServer);
  await plugin.await();
  ctx.webServer.register({
    kind: 'exact', path: '/', handler(req, res) {
      if (ctx.connection.authorizeIndex(req, res)) res.end('authenticated');
    },
  });
  const base = `http://127.0.0.1:${ctx.webServer.port}`;
  const infoUrl = `${base}/api/app-server/info`;
  assert.equal((await fetch(infoUrl)).status, 401);
  assert.equal((await fetch(`${base}/?token=invalid`, { redirect: 'manual' })).status, 401);
  const login = await fetch(ctx.connection.authenticatedUrl(`${base}/`), { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const response = await fetch(infoUrl, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    product: 'dsh-app-server', protocolVersion: 1, platform: process.platform,
  });
  assert.equal((await fetch(infoUrl, {
    headers: { cookie, origin: 'https://attacker.example' },
  })).status, 403);
  assert.equal((await fetch(infoUrl, {
    headers: { cookie, 'sec-fetch-site': 'cross-site' },
  })).status, 403);
  assert.equal((await fetch(infoUrl, { method: 'POST', headers: { cookie } })).status, 404);
  await plugin.dispose();
  assert.equal((await fetch(infoUrl, { headers: { cookie } })).status, 404);
});
