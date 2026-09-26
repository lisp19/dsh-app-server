import test from 'node:test';
import assert from 'node:assert/strict';
import * as AppServer from '../packages/server/src/index.js';

test('plugin registers authenticated discovery through the public Connection service', async () => {
  let route;
  let dispose;
  const ctx = {
    connection: { fetch: { register(value) { route = value; return () => { route = undefined; }; } } },
    effect(effect) { dispose = effect(); },
  };
  assert.deepEqual(AppServer.inject, ['connection', 'webServer']);
  await AppServer.apply(ctx);
  assert.equal(route.path, '/api/app-server/info');
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { product: 'dsh-app-server', protocolVersion: 1, platform: process.platform });
  dispose();
  assert.equal(route, undefined);
});
