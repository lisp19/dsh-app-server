import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createLocalBridge } from '../src/local-bridge.js';

async function fixture(t) {
  const received = [];
  const upstream = http.createServer((req, res) => {
    received.push(req.headers);
    if (req.url === '/external') res.writeHead(302, { location: 'https://evil.test/', 'set-cookie': 'secret=remote' });
    else if (req.url === '/redirect') res.writeHead(303, { location: `http://${req.headers.host}/next`, 'set-cookie': 'secret=remote' });
    else if (req.url === '/unauthorized') res.writeHead(401);
    else res.writeHead(200, { 'set-cookie': 'secret=remote' });
    req.pipe(res);
  });
  upstream.on('upgrade', (req, socket, head) => {
    received.push(req.headers);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;
  const bridge = await createLocalBridge({ upstreamURL, getCookies: async () => [{ name: 'auth', value: 'remote-secret' }] });
  t.after(() => { bridge.close(); upstream.closeAllConnections(); upstream.close(); });
  const headers = { [bridge.headerName]: bridge.secret };
  return { bridge, headers, received, upstreamURL };
}

test('local bridge streams authenticated requests without leaking credentials or cookies', async t => {
  const { bridge, headers, received, upstreamURL } = await fixture(t);
  const response = await fetch(bridge.url + 'upload', { method: 'POST', headers: { ...headers, origin: new URL(bridge.url).origin, cookie: 'attacker=yes', authorization: 'Bearer attacker', 'x-forwarded-host': 'evil' }, body: 'streamed content' });
  assert.equal(await response.text(), 'streamed content');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(received[0].cookie, 'auth=remote-secret');
  assert.equal(received[0].origin, upstreamURL);
  assert.equal(received[0][bridge.headerName], undefined);
  assert.equal(received[0].authorization, undefined);
  assert.equal(received[0]['x-forwarded-host'], undefined);
});

test('URL alone, hostile origins, host aliases, absolute URLs and fetch sites are rejected', async t => {
  const { bridge, headers, received } = await fixture(t);
  for (const extra of [{}, { ...headers, origin: 'http://evil.test' }, { ...headers, host: 'localhost:1234' }, { ...headers, 'sec-fetch-site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      const request = http.request(bridge.url, { headers: extra }, res => { res.resume(); resolve(res.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 403);
  }
  const status = await new Promise((resolve, reject) => {
    const request = http.request(bridge.url, { path: 'http://evil.test/', headers }, res => { res.resume(); resolve(res.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
  assert.equal(received.length, 0);
});

test('same-origin redirects become local, external redirects are blocked, auth failures survive', async t => {
  const { bridge, headers } = await fixture(t);
  const response = await fetch(bridge.url + 'redirect', { headers, redirect: 'manual' });
  assert.equal(response.headers.get('location'), bridge.url + 'next');
  assert.equal((await fetch(bridge.url + 'external', { headers, redirect: 'manual' })).status, 502);
  assert.equal((await fetch(bridge.url + 'unauthorized', { headers })).status, 401);
});

test('websocket upgrades require the local secret and stream in both directions', async t => {
  const { bridge, headers, received } = await fixture(t);
  const url = new URL(bridge.url);
  const socket = net.connect(Number(url.port), url.hostname);
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write(`GET /socket HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${url.origin}\r\n${bridge.headerName}: ${headers[bridge.headerName]}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  const [handshake] = await once(socket, 'data');
  assert.match(handshake.toString(), /^HTTP\/1.1 101/);
  socket.write('websocket-bytes');
  const [echo] = await once(socket, 'data');
  assert.equal(echo.toString(), 'websocket-bytes');
  assert.equal(received[0].cookie, 'auth=remote-secret');
  bridge.close();
  await once(socket, 'close');
});

test('unauthenticated websocket upgrades and CONNECT cannot reach upstream', async t => {
  const { bridge, received } = await fixture(t);
  const url = new URL(bridge.url);
  for (const method of ['GET', 'CONNECT']) {
    const socket = net.connect(Number(url.port), url.hostname);
    await once(socket, 'connect');
    socket.write(`${method} /socket HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    const [response] = await once(socket, 'data');
    assert.match(response.toString(), /^HTTP\/1.1 403/);
    socket.destroy();
  }
  assert.equal(received.length, 0);
});

test('cancellation closes listener and pending upstream transfers', async t => {
  const upstream = http.createServer(() => {});
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const controller = new AbortController();
  const bridge = await createLocalBridge({ upstreamURL: `http://127.0.0.1:${upstream.address().port}`, getCookies: async () => [], signal: controller.signal });
  const upstreamRequest = once(upstream, 'request');
  const pending = fetch(bridge.url, { headers: { [bridge.headerName]: bridge.secret } });
  const rejected = assert.rejects(pending);
  await upstreamRequest;
  controller.abort();
  await rejected;
  await assert.rejects(fetch(bridge.url));
  await assert.rejects(createLocalBridge({ upstreamURL: 'http://127.0.0.1', getCookies: async () => [], signal: controller.signal }));
});

test('HTTPS upstream certificates are verified by default', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-bridge-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const upstream = https.createServer({ key: await readFile(path.join(directory, 'key.pem')), cert: await readFile(path.join(directory, 'cert.pem')) }, (_req, res) => res.end('must not load'));
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const bridge = await createLocalBridge({ upstreamURL: `https://127.0.0.1:${upstream.address().port}`, getCookies: async () => [] });
  t.after(() => { bridge.close(); upstream.closeAllConnections(); upstream.close(); });
  assert.equal((await fetch(bridge.url, { headers: { [bridge.headerName]: bridge.secret } })).status, 502);
});
