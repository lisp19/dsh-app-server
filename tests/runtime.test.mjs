import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { nativeSession } from '../scripts/runtime.mjs';

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
