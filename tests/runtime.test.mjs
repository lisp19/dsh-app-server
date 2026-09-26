import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeSession, startRuntime } from '../scripts/runtime.mjs';

test('native session exchanges a public bootstrap URL without exposing the launch token', async t => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.url, '/?token=fixture-bootstrap');
    res.writeHead(303, { location: './', 'set-cookie': 'native=fixture; HttpOnly; Path=/' }).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const session = nativeSession(`http://127.0.0.1:${server.address().port}/?token=fixture-bootstrap`);
  assert.equal(await session.cookie(), 'native=fixture');
  assert.equal(await session.cookie(), 'native=fixture');
  assert.equal(requests, 1);
  assert.equal(session.origin.includes('token'), false);
  assert.throws(() => nativeSession('https://example.com/?token=secret'));
});

test('native session refuses redirected or unauthenticated bootstrap responses', async t => {
  const server = createServer((_req, res) => res.writeHead(303, { location: 'https://example.com/', 'set-cookie': 'native=x' }).end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const session = nativeSession(`http://127.0.0.1:${server.address().port}/?token=x`);
  await assert.rejects(session.cookie(), /bootstrap/);
});

async function nativeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-runtime-lifecycle-'));
  const cli = join(directory, 'native.mjs');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(cli, `
    import { createServer } from 'node:http';
    import { writeFile } from 'node:fs/promises';
    await writeFile(process.env.DSH_HOME + '/fixture.pid', String(process.pid));
    if (process.env.FIXTURE_FAIL) {
      console.error('Native private launch URL: http://127.0.0.1/?token=fixture-secret');
      process.exit(42);
    }
    if (process.env.FIXTURE_STALL) {
      setInterval(() => {}, 1000);
    } else {
      const server = createServer((req, res) => {
        if (req.url === '/?token=fixture-secret') {
          res.writeHead(303, { location: './', 'set-cookie': 'native=fixture; HttpOnly; Path=/' });
        } else if (req.headers.cookie !== 'native=fixture') res.writeHead(401);
        res.end('native response');
      });
      server.listen(0, '127.0.0.1', async () => {
        await writeFile(process.env.DSH_APP_SERVER_BOOTSTRAP_FILE,
          JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port + '/?token=fixture-secret', upstreamVersion: 'fixture' }),
          { mode: 0o600, flag: 'wx' });
      });
    }
  `);
  const config = { cli, home: directory, workspace: directory, profile: 'fixture', host: '127.0.0.1', port: 0 };
  return { directory, config };
}

test('runtime normal close terminates native process, closes gateway, and removes private bootstrap', { timeout: 10000 }, async t => {
  const { config } = await nativeFixture(t);
  let exitNotifications = 0;
  const runtime = await startRuntime(config, { password: 'fixture-password', onExit: () => exitNotifications++ });
  t.after(() => runtime.close());
  assert.equal((await stat(runtime.runtimeDirectory)).mode & 0o777, 0o700);
  const overlay = await readFile(join(runtime.runtimeDirectory, 'native.yml'), 'utf8');
  assert.match(overlay, /host: 127\.0\.0\.1\n    port: 0/);
  const login = await fetch(runtime.url + '/?token=fixture-password', { redirect: 'manual' });
  assert.equal(login.status, 303);
  await runtime.close();
  await runtime.close();
  assert.equal(exitNotifications, 0);
  assert.throws(() => process.kill(runtime.child.pid, 0), { code: 'ESRCH' });
  await assert.rejects(stat(runtime.runtimeDirectory), { code: 'ENOENT' });
  await assert.rejects(fetch(runtime.url, { signal: AbortSignal.timeout(1000) }));
});

test('unexpected native exit cleans up before notifying the runtime owner', { timeout: 10000 }, async t => {
  const { config } = await nativeFixture(t);
  let notify;
  const notified = new Promise(resolve => { notify = resolve; });
  const runtime = await startRuntime(config, { password: 'fixture-password', onExit: notify });
  t.after(() => runtime.close());
  runtime.child.kill('SIGKILL');
  assert.equal(await notified, 1);
  await assert.rejects(stat(runtime.runtimeDirectory), { code: 'ENOENT' });
  await assert.rejects(fetch(runtime.url, { signal: AbortSignal.timeout(1000) }));
});

test('failed native startup removes private directory and withholds native credential output', { timeout: 10000 }, async t => {
  const { directory, config } = await nativeFixture(t);
  const logs = [];
  await assert.rejects(startRuntime(config, {
    password: 'fixture-password', env: { FIXTURE_FAIL: '1' }, onLog: message => logs.push(message),
  }), /exited during startup/);
  assert.deepEqual(await readdir(join(directory, '.app-server-runtime')), []);
  assert.equal(logs.some(message => message.includes('fixture-secret')), false);
  const pid = Number(await readFile(join(directory, 'fixture.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('readiness timeout terminates a stalled child and removes bootstrap directory', { timeout: 10000 }, async t => {
  const { directory, config } = await nativeFixture(t);
  await assert.rejects(startRuntime(config, {
    password: 'fixture-password', env: { FIXTURE_STALL: '1' }, startupTimeoutMs: 250,
  }), /readiness timed out/);
  assert.deepEqual(await readdir(join(directory, '.app-server-runtime')), []);
  const pid = Number(await readFile(join(directory, 'fixture.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
