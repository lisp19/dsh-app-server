import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { authenticate, ConnectionAttempts, validateServerInfo } from '../src/connection.js';
import { allowsNavigation, errorCode, isSettingsSender, parseServerURL } from '../src/security.js';
import { exchangeToken } from '../src/token-exchange.js';

const validInfo = { product: 'dsh-app-server', protocolVersion: 1, platform: 'linux' };
const rejectsCode = code => error => error.code === code;

test('explicit root HTTP and HTTPS URLs are accepted', () => {
  for (const url of ['https://example.com', 'https://example.com:9443/', 'http://127.0.0.1:3000/', 'http://localhost/', 'http://[::1]:3000/', 'http://example.com', 'http://192.0.2.10:3080/', 'http://localhost.evil.test']) {
    assert.equal(parseServerURL(url).pathname, '/');
  }
  for (const url of ['file:///etc/passwd', 'https://user:secret@example.com/', 'https://@example.com/', 'https://example.com/?token=secret', 'https://example.com/#secret', 'https://example.com/path', 'https://example.com/a/..', 'https://example.com\\@evil.test', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'https://example.com/?', 'https://example.com/#']) {
    assert.throws(() => parseServerURL(url), undefined, url);
  }
});

test('navigation permits only the chosen origin without credentials', () => {
  const origin = 'https://server.example';
  assert.equal(allowsNavigation(`${origin}/session/123#turn`, origin), true);
  for (const target of ['https://evil.test', 'https://server.example.evil.test', 'http://server.example', 'https://server.example:9443', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://user@server.example/']) {
    assert.equal(allowsNavigation(target, origin), false);
  }
});

test('settings IPC requires exact window, main frame, and local URL', () => {
  const frame = { url: 'file:///app/settings.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  assert.equal(isSettingsSender(event, window, frame.url), true);
  assert.equal(isSettingsSender({ ...event, sender: {} }, window, frame.url), false);
  assert.equal(isSettingsSender({ ...event, senderFrame: { ...frame } }, window, frame.url), false);
  assert.equal(isSettingsSender(event, window, 'file:///app/settings.html?x'), false);
  assert.equal(isSettingsSender(event, undefined, frame.url), false);
});

function mockSession({ loginStatus = 303, location = '/', info = validInfo, contentType = 'application/json', infoStatus = 200, cookies = [{ name: 'auth' }] } = {}) {
  const calls = [];
  return {
    calls, cookies: { get: async () => cookies },
    async fetch(url, options) {
      calls.push({ url, options });
      return calls.length === 1
        ? new Response(null, { status: loginStatus, headers: { location } })
        : new Response(JSON.stringify(info), { status: infoStatus, headers: { 'content-type': contentType } });
    },
  };
}

test('token exchange is manual and the identity request contains no token', async () => {
  const session = mockSession();
  const result = await authenticate(session, 'https://server.example', 'a&b#c', new AbortController().signal);
  assert.equal(result.info.platform, 'linux');
  assert.equal(new URL(session.calls[0].url).searchParams.get('token'), 'a&b#c');
  assert.equal(session.calls[1].url, 'https://server.example/api/app-server/info');
  assert.ok(session.calls.every(call => call.options.redirect === 'manual' && call.options.credentials === 'include'));
});

test('failed auth, absent cookie, and redirects never load another destination', async () => {
  for (const config of [{ loginStatus: 401 }, { loginStatus: 200 }, { location: 'https://evil.test/' }, { location: '/?token=leak' }, { cookies: [] }]) {
    const session = mockSession(config);
    await assert.rejects(authenticate(session, 'https://server.example', 'secret', new AbortController().signal), rejectsCode('auth'));
    assert.equal(session.calls.length, 1);
  }
});

test('info endpoint distinguishes unauthorized, missing plugin and protocol mismatch', async () => {
  for (const [config, code] of [[{ infoStatus: 401 }, 'auth'], [{ infoStatus: 404 }, 'missingPlugin'], [{ contentType: 'text/html' }, 'missingPlugin'], [{ info: { product: 'other' } }, 'missingPlugin'], [{ info: { ...validInfo, protocolVersion: 2 } }, 'protocol']]) {
    await assert.rejects(authenticate(mockSession(config), 'https://server.example', 'secret', new AbortController().signal), rejectsCode(code));
  }
  assert.equal(validateServerInfo({ ...validInfo, platform: 'win32' }).platform, 'win32');
});

test('a newer attempt cancels the old one and late completion cannot win', async () => {
  const attempts = new ConnectionAttempts();
  let finishOld;
  let oldSignal;
  const first = attempts.run(signal => { oldSignal = signal; return new Promise(resolve => { finishOld = resolve; }); });
  const rejected = assert.rejects(first, rejectsCode('cancelled'));
  await Promise.resolve();
  const second = attempts.run(async () => 'new');
  assert.equal(await second, 'new');
  assert.equal(oldSignal.aborted, true);
  finishOld('stale');
  await rejected;
});

test('timeout and explicit cancellation settle a nonresponsive operation', async () => {
  const attempts = new ConnectionAttempts();
  await assert.rejects(attempts.run(() => new Promise(() => {}), 5), rejectsCode('timeout'));
  const pending = attempts.run(() => new Promise(() => {}));
  const rejected = assert.rejects(pending, rejectsCode('cancelled'));
  attempts.cancel();
  await rejected;
});

test('network error details and token-bearing URLs never become display strings', () => {
  assert.equal(errorCode(new Error('ERR_CERT_AUTHORITY_INVALID https://server/?token=secret')), 'tls');
  assert.equal(errorCode(new Error('Failed to fetch https://server/?token=secret')), 'network');
});

test('Electron redirect exchange aborts the request without following the target', async () => {
  const request = new EventEmitter();
  let aborted = false;
  request.abort = () => { aborted = true; request.emit('error', new Error('aborted')); };
  request.followRedirect = () => assert.fail('Redirect must never be followed');
  request.end = () => request.emit('redirect', 303, 'GET', 'https://evil.test/', { location: ['https://evil.test/'] });
  const session = {};
  const response = await exchangeToken(options => {
    assert.equal(options.session, session);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.useSessionCookies, true);
    return request;
  }, session, 'https://server.example/?token=fixture', new AbortController().signal);
  assert.equal(aborted, true);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://evil.test/');
});

test('Electron redirect exchange propagates cancellation to the underlying request', async () => {
  const request = new EventEmitter();
  const controller = new AbortController();
  let aborted = false;
  request.end = () => {};
  request.abort = () => { aborted = true; };
  const pending = exchangeToken(() => request, {}, 'https://server.example/', controller.signal);
  const reason = new Error('cancel fixture');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(aborted, true);
});

test('cancellation before an attempt starts prevents its operation entirely', async () => {
  const attempts = new ConnectionAttempts();
  let called = false;
  const pending = attempts.run(() => { called = true; });
  attempts.cancel();
  await assert.rejects(pending, rejectsCode('cancelled'));
  assert.equal(called, false);
});
