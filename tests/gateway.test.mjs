import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

const { createGateway } = await import('../packages/server/src/gateway.js').catch(() => ({}));

async function fixture(t) {
  assert.equal(typeof createGateway, 'function', 'gateway exports createGateway');
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === '/external') { res.writeHead(302, { location: 'https://example.com/' }); return res.end(); }
    if (req.url === '/redirect') { res.writeHead(302, { location: `http://127.0.0.1:${upstream.address().port}/next` }); return res.end(); }
    if (req.url === '/expired') { res.writeHead(401, { 'set-cookie': 'native=leak' }); return res.end('expired'); }
    res.setHeader('set-cookie', 'native=leak');
    req.pipe(res);
  });
  upstream.on('upgrade', (req, socket, head) => {
    seen.push(req.headers);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = await createGateway({ upstreamURL: `http://127.0.0.1:${upstream.address().port}`, upstreamCookie: 'native=secret', password: 'password', upstreamVersion: 'fixture', trustedHosts: ['allowed.example'] });
  t.after(async () => { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const request = (path = '/', options = {}) => new Promise((resolve, reject) => {
    const req = http.request(gateway.url + path, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  const login = await request('/?token=password');
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), './');
  assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/i);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.ok(!cookie.includes('native'));
  return { gateway, request, cookie, seen };
}

test('gateway owns authentication, discovery, and authority-bound sessions', async t => {
  const { request, cookie } = await fixture(t);
  assert.equal((await request()).status, 401);
  assert.equal((await request('/?token=wrong')).status, 401);
  assert.equal((await request('/', { headers: { cookie: 'native=secret' } })).status, 401);
  const info = await request('/api/app-server/info', { headers: { cookie } });
  assert.equal(info.status, 200);
  const body = await info.json();
  assert.equal(body.protocolVersion, 2);
  assert.equal(body.upstreamVersion, 'fixture');
  assert.equal(body.product, 'dsh-app-server');
  for (const headers of [{ origin: 'https://attacker.example' }, { host: 'attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request('/', { headers: { cookie, ...headers } })).status, 403);
  }
  assert.equal((await request('/', { headers: { cookie, host: '127.0.0.1:54321' } })).status, 401);
  assert.equal((await request('/?token=password', { headers: { host: '127.0.0.1:54321' } })).status, 303);
  assert.equal((await request('/?token=password', { headers: { host: 'allowed.example' } })).status, 303);
});

test('gateway streams bodies and sanitizes headers and redirects', async t => {
  const { request, cookie, seen } = await fixture(t);
  const body = 'payload'.repeat(100000);
  const response = await request('/echo?x=1', { method: 'POST', body, headers: { cookie, authorization: 'Bearer hostile', forwarded: 'host=evil', 'x-forwarded-host': 'evil', 'proxy-authorization': 'secret' } });
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(seen[0].cookie, 'native=secret');
  for (const header of ['authorization', 'forwarded', 'x-forwarded-host', 'proxy-authorization']) assert.equal(seen[0][header], undefined);
  assert.equal((await request('/external', { headers: { cookie } })).status, 502);
  assert.equal((await request('/redirect', { headers: { cookie } })).headers.get('location'), '/next');
  assert.equal((await request('/expired', { headers: { cookie } })).status, 401);
});

test('gateway authorizes upgrades and streams bidirectionally', async t => {
  const { gateway, cookie, seen } = await fixture(t);
  const upgrade = headers => new Promise((resolve, reject) => {
    const req = http.request(gateway.url + '/socket', { headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers } });
    req.on('upgrade', (res, socket) => resolve({ res, socket }));
    req.on('response', res => { res.resume(); resolve({ res }); });
    req.on('error', reject);
    req.end();
  });
  assert.equal((await upgrade({})).res.statusCode, 401);
  assert.equal((await upgrade({ cookie, origin: 'http://evil.example' })).res.statusCode, 403);
  const { res, socket } = await upgrade({ cookie });
  assert.equal(res.statusCode, 101);
  assert.equal(seen.at(-1).cookie, 'native=secret');
  socket.write('hello');
  assert.equal((await once(socket, 'data'))[0].toString(), 'hello');
  const closed = once(socket, 'close');
  await gateway.close();
  await closed;
});

test('gateway validates private upstream and nonempty password', async () => {
  assert.equal(typeof createGateway, 'function');
  for (const upstreamURL of ['http://example.com', 'http://127.0.0.1.evil.com', 'https://127.0.0.1', 'http://user:pass@127.0.0.1']) {
    await assert.rejects(createGateway({ upstreamURL, upstreamCookie: 'native=secret', password: 'ok' }));
  }
  await assert.rejects(createGateway({ upstreamURL: 'http://127.0.0.1:1', upstreamCookie: 'native=secret', password: '' }));
});

test('gateway obtains renewed native credentials for each authenticated proxy request', async t => {
  assert.equal(typeof createGateway, 'function');
  const upstream = http.createServer((req, res) => res.end(req.headers.cookie));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let generation = 0;
  const gateway = await createGateway({ upstreamURL: `http://127.0.0.1:${upstream.address().port}`, password: 'password', getUpstreamCookie: async () => `native=${++generation}` });
  t.after(async () => { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const login = await fetch(gateway.url + '/?token=password', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal(await (await fetch(gateway.url, { headers: { cookie } })).text(), 'native=1');
  assert.equal(await (await fetch(gateway.url, { headers: { cookie } })).text(), 'native=2');
});

test('gateway bounds login attempts and never accepts a different gateway session', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  assert.equal((await second.request('/', { headers: { cookie: first.cookie } })).status, 401);
  for (let i = 0; i < 19; i++) assert.equal((await first.request('/?token=wrong')).status, 401);
  assert.equal((await first.request('/?token=wrong')).status, 429);
  assert.equal((await first.request('/?token=password')).status, 429);
});

test('gateway forwards streaming uploads before completion and cancels the native request', async t => {
  let upstreamRequest;
  let sawChunk;
  const firstChunk = new Promise(resolve => { sawChunk = resolve; });
  const upstream = http.createServer((req, res) => {
    upstreamRequest = req;
    req.once('data', chunk => { res.write(chunk); sawChunk(); });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = await createGateway({ upstreamURL: `http://127.0.0.1:${upstream.address().port}`, upstreamCookie: 'native=secret', password: 'password' });
  t.after(async () => { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const login = await fetch(gateway.url + '/?token=password', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const upload = http.request(gateway.url + '/stream', { method: 'POST', headers: { cookie } });
  upload.on('error', () => {});
  upload.write('first chunk');
  await firstChunk;
  const aborted = new Promise(resolve => upstreamRequest.once('aborted', resolve));
  upload.destroy();
  await aborted;
});
