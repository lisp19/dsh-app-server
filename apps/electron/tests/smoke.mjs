/** Run with xvfb-run -a node apps/electron/tests/smoke.mjs on headless Linux. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const directory = await mkdtemp(path.join(tmpdir(), 'dsh-electron-smoke-'));
const appDirectory = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const secret = 'smoke-only-secret';
let infoVersion = 1;
let expire = false;
let rejectGUI = false;
let serverRequests = 0;
const secondLoginCookies = [];
const handleRequest = (name, loginCookies) => (req, res) => {
  serverRequests++;
  const target = new URL(req.url, 'http://localhost');
  if (target.pathname === '/' && target.searchParams.has('token')) {
    loginCookies?.push(req.headers.cookie);
    if (target.searchParams.get('token') !== secret) { res.writeHead(401).end(); return; }
    res.writeHead(303, { location: './', 'set-cookie': 'auth=fixture; HttpOnly; SameSite=Strict; Path=/' }).end();
    return;
  }
  if (req.url === '/alive') { res.end('alive'); return; }
  if (req.headers.cookie !== 'auth=fixture' || expire) { res.writeHead(401).end(); return; }
  if (req.url === '/api/app-server/info') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ product: 'dsh-app-server', protocolVersion: infoVersion, platform: 'linux' }));
    return;
  }
  if (rejectGUI) { res.writeHead(401).end('Authentication required'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Remote fixture</title><h1>${name}</h1><a id="external" href="https://example.invalid/">Outside</a>`);
};
const server = createServer(handleRequest('Remote workspace'));
const secondServer = createServer(handleRequest('Second workspace', secondLoginCookies));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secondServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const secondOrigin = `http://127.0.0.1:${secondServer.address().port}`;
let application;
try {
  const executablePath = process.env.DSH_ELECTRON_EXECUTABLE;
  application = await _electron.launch({
    ...(executablePath ? { executablePath: path.resolve(executablePath) } : {}),
    args: [...(executablePath ? [] : [appDirectory]), `--user-data-dir=${directory}`, '--lang=en-US'],
    timeout: 20000,
  });
  const settings = await application.firstWindow();
  await settings.locator('#connect').waitFor();
  if (await settings.locator('#remember').isChecked()) await settings.locator('#remember').uncheck();
  assert.equal(await settings.locator('#token').inputValue(), '');
  const screenshot = fileURLToPath(new URL('../../../artifacts/screenshots/connection.png', import.meta.url));
  await mkdir(path.dirname(screenshot), { recursive: true });
  await settings.screenshot({ path: screenshot });
  await settings.locator('#server').fill(origin);
  await settings.locator('#token').fill('wrong-token');
  await settings.locator('#connect').click();
  await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('Authentication failed'));
  assert.equal(await settings.locator('#token').inputValue(), '');

  infoVersion = 2;
  await settings.locator('#token').fill(secret);
  await settings.locator('#connect').click();
  await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('incompatible protocol'));
  infoVersion = 1;

  rejectGUI = true;
  await settings.locator('#token').fill(secret);
  await settings.locator('#connect').click();
  await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('Authentication failed'));
  assert.equal(application.windows().length, 1);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  rejectGUI = false;

  const openRemote = async () => {
    await settings.locator('#token').fill(secret);
    const opened = application.waitForEvent('window');
    await settings.locator('#connect').click();
    const remote = await opened;
    await remote.waitForSelector('h1');
    await application.evaluate(async ({ BrowserWindow }) => {
      const deadline = Date.now() + 10000;
      while (!BrowserWindow.getAllWindows().some(window => window.isVisible() && window.webContents.getURL().startsWith('http:'))) {
        if (Date.now() > deadline) throw new Error('Remote window was not shown');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    });
    return remote;
  };
  let remote = await openRemote();
  assert.equal(await remote.locator('h1').textContent(), 'Remote workspace');
  assert.deepEqual(await remote.evaluate(() => [typeof window.require, typeof window.process, typeof window.connectionSettings]), ['undefined', 'undefined', 'undefined']);
  const prefs = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL().startsWith('http:'));
    const p = window.webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, preload: p.preload };
  });
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.ok(!prefs.preload);
  await remote.locator('#external').click({ noWaitAfter: true });
  assert.equal(remote.url(), `${origin}/`);
  assert.equal(await remote.evaluate(() => window.open('https://example.invalid/') === null), true);
  const saved = await readFile(path.join(directory, 'connection.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), { version: 2, url: `${origin}/`, transport: 'direct', remember: false });
  assert.ok(!saved.includes(secret));

  expire = true;
  await remote.evaluate(() => { void fetch('/api/expired').catch(() => {}); });
  await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('Authentication failed'));
  assert.equal(application.windows().length, 1);
  expire = false;
  remote = await openRemote();

  const previousRemote = remote;
  const previousClosed = previousRemote.waitForEvent('close');
  await application.evaluate(({ Menu }) => {
    const changeServer = Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Change server…');
    if (!changeServer) throw new Error('Change server menu item missing');
    changeServer.click();
  });
  await previousClosed;
  assert.equal(previousRemote.isClosed(), true);
  assert.equal(application.windows().length, 1);
  await settings.locator('#server').fill(secondOrigin);
  remote = await openRemote();
  assert.equal(await remote.locator('h1').textContent(), 'Second workspace');
  assert.equal(remote.url(), `${secondOrigin}/`);
  assert.deepEqual(secondLoginCookies, [undefined]);
  assert.equal(await remote.evaluate(async () => (await fetch('/alive')).text()), 'alive');
  assert.equal(await (await fetch(`${origin}/alive`)).text(), 'alive');

  const closed = application.waitForEvent('close');
  await remote.close();
  await closed;
  application = undefined;
  assert.equal(await (await fetch(`${origin}/alive`)).text(), 'alive');
  assert.equal(await (await fetch(`${secondOrigin}/alive`)).text(), 'alive');
  console.log(`Electron smoke passed: auth, protocol, initial GUI 401, isolation, navigation, persistence, runtime 401, reconnect, server switch with no cookie transfer, client-only close (${serverRequests} fixture requests). Connection screenshot: ${screenshot}`);
} finally {
  await application?.close();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => secondServer.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
