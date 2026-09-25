/** Exercise the independent Electron shell against a real Linux Harness profile. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { startHarness, root, readSessionLog } from './harness.mjs';

const host = await startHarness({ sequence: ['slow_success'], successText: 'ELECTRON_REMOTE_TURN_OK', chunkDelayMs: 400 });
const executablePath = process.env.DSH_ELECTRON_EXECUTABLE;
const launchOptions = userData => ({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [join(root, 'apps/electron')]), `--user-data-dir=${userData}`, '--lang=en-US'],
  timeout: 30_000,
});
let application;
let remote;
let settings;
const requests = [];
const pageErrors = [];
try {
  const userData = join(host.run, 'electron-data');
  await mkdir(userData);
  application = await electron.launch(launchOptions(userData));
  const frames = [];
  const bridges = [];
  await application.context().routeWebSocket('**/api/remote.mux', client => {
    const server = client.connectToServer();
    bridges.push({ client, server });
    client.onMessage(message => server.send(message));
    server.onMessage(message => {
      frames.push(JSON.parse(message.toString()));
      client.send(message);
    });
  });
  settings = await application.firstWindow();
  await settings.locator('#server').fill(host.base);
  await settings.locator('#token').fill('wrong-token');
  await settings.locator('#connect').click();
  await settings.locator('#status').filter({ hasText: /authentication|认证/i }).waitFor();
  assert.equal(await settings.locator('#token').inputValue(), '');
  await settings.locator('#token').fill(host.token);
  const opened = application.waitForEvent('window');
  await settings.locator('#connect').click();
  remote = await opened;
  // A window is published before authentication finishes saving the URL and
  // showing it. Wait for the native settings-to-workspace handoff before input.
  await application.evaluate(async ({ BrowserWindow }) => {
    const settings = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'));
    if (settings.isVisible()) await new Promise(resolve => settings.once('hide', resolve));
    const workspace = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:'));
    if (!workspace?.isVisible()) throw new Error('Remote workspace was not shown after settings closed');
  });
  remote.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/api/')) requests.push({ pathname, status: response.status() });
  });
  remote.on('pageerror', error => pageErrors.push(error.message));
  await remote.waitForURL(`${host.base}/`);
  await remote.locator('#root').waitFor({ timeout: 30_000 });
  console.log('Electron authenticated and loaded the actual Harness GUI.');
  await mkdir(join(root, 'artifacts/screenshots'), { recursive: true });
  await remote.screenshot({ path: join(root, 'artifacts/screenshots/remote-start.png') });
  await remote.getByRole('button', { name: 'Continue', exact: true }).click();
  const isolated = await remote.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: typeof window.connectionSettings }));
  assert.deepEqual(isolated, { require: 'undefined', process: 'undefined', bridge: 'undefined' });
  const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(window => window.webContents.getURL().startsWith('http'))
    .map(window => window.webContents.getLastWebPreferences()));
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0].sandbox, true);
  assert.equal(preferences[0].nodeIntegration, false);
  assert.equal(preferences[0].contextIsolation, true);
  assert.equal(preferences[0].preload, undefined);
  const saved = await readFile(join(userData, 'connection.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), { url: `${host.base}/` });
  assert.equal(saved.includes(host.token), false);
  console.log('PASS: remote renderer has no Node/preload bridge; persisted settings contain only URL.');
  const composer = remote.locator('[data-composer-input][contenteditable="true"][data-phase="plain"]:not([aria-disabled="true"])').last();
  await composer.waitFor();
  await composer.click();
  await composer.fill('Reply with the remote integration marker.');
  // Lexical publishes its draft to the input machine asynchronously. Send is
  // enabled only after that draft is actionable; DOM text alone is insufficient.
  await remote.getByRole('button', { name: 'Send message', exact: true }).and(remote.locator(':enabled')).waitFor();
  const accepted = remote.waitForResponse(response => response.url().endsWith('/api/session/prompt'));
  await composer.press('Enter');
  const firstPrompt = await accepted;
  assert.equal(firstPrompt.status(), 200);
  const sessionId = firstPrompt.request().postDataJSON().payload.args.request.sessionId;
  await remote.getByText('ELECTRON_REMOTE_TURN_OK', { exact: true }).first().waitFor({ timeout: 30_000 });
  assert.ok(frames.some(frame => frame.value?.type === 'assistant-stream'), 'GUI must receive live model stream frames');
  await remote.screenshot({ path: join(root, 'artifacts/screenshots/remote-chat.png') });
  console.log('PASS: GUI prompt and live assistant stream.', { sessionId });

  await remote.getByRole('button', { name: 'Add workspace', exact: true }).click();
  const picker = remote.getByRole('dialog', { name: 'Select Workspace Directory' });
  await picker.getByRole('button', { name: 'Edit path', exact: true }).click();
  const path = picker.getByRole('textbox', { name: 'Edit path' });
  await path.fill(host.workspace);
  const listing = remote.waitForResponse(response => response.url().endsWith('/api/directoryPicker/list') && response.ok());
  await path.press('Enter');
  const listed = await (await listing).json();
  assert.ok(JSON.stringify(listed).includes(host.workspace));
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS: in-page picker browses the Linux workspace.');

  const readyCount = () => frames.filter(frame => frame.value?.type === 'ready').length;
  const beforeRecovery = readyCount();
  assert.ok(bridges.length > 0);
  const bridge = bridges.at(-1);
  await Promise.all([
    bridge.client.close({ code: 1012, reason: 'integration network interruption' }),
    bridge.server.close({ code: 1012, reason: 'integration network interruption' }),
  ]);
  const recoveryDeadline = Date.now() + 20_000;
  while (readyCount() <= beforeRecovery && Date.now() < recoveryDeadline) await delay(100);
  assert.ok(readyCount() > beforeRecovery, 'GUI must establish a new authenticated stream generation');
  console.log('PASS: network loss recovers through a fresh WebSocket generation.');

  await composer.fill('Continue while the desktop client exits.');
  await remote.getByRole('button', { name: 'Send message', exact: true }).and(remote.locator(':enabled')).waitFor();
  const secondAccepted = remote.waitForResponse(response => response.url().endsWith('/api/session/prompt'));
  const beforeRequests = host.model.requests.length;
  await composer.press('Enter');
  assert.equal((await secondAccepted).status(), 200);
  const startedDeadline = Date.now() + 10_000;
  while (host.model.requests.length === beforeRequests && Date.now() < startedDeadline) await delay(20);
  assert.ok(host.model.requests.length > beforeRequests, 'second model request must start before closing Electron');
  assert.deepEqual(pageErrors, []);
  await application.close();
  application = undefined;
  assert.equal((await fetch(`${host.base}/api/app-server/info`, { headers: { cookie: host.cookie } })).status, 200);
  const completionDeadline = Date.now() + 30_000;
  let events = [];
  while (Date.now() < completionDeadline) {
    events = await readSessionLog(host, sessionId);
    if (events.filter(event => event.type === 'turn/end').length >= 2) break;
    await delay(100);
  }
  assert.equal(events.filter(event => event.type === 'turn/end').length, 2);
  console.log('PASS: the in-flight server turn completes and persists after Electron exits.');

  application = await electron.launch(launchOptions(userData));
  settings = await application.firstWindow();
  await settings.waitForFunction(() => document.querySelector('#server').value.length > 0);
  assert.equal(await settings.locator('#server').inputValue(), `${host.base}/`);
  assert.equal(await settings.locator('#token').inputValue(), '');
  await settings.locator('#token').fill(host.token);
  const reopened = application.waitForEvent('window');
  await settings.locator('#connect').click();
  remote = await reopened;
  await remote.getByRole('treeitem').filter({ hasText: 'Reply with the remote integration' }).click({ timeout: 30_000 });
  await remote.getByText('Continue while the desktop client exits.', { exact: true }).waitFor({ timeout: 20_000 });
  assert.equal(await remote.getByText('ELECTRON_REMOTE_TURN_OK', { exact: true }).count(), 2);
  await remote.screenshot({ path: join(root, 'artifacts/screenshots/reconnected-history.png') });
  console.log('PASS: restarting Electron restores server-side conversation history after reauthentication.');
} catch (error) {
  if (settings && !settings.isClosed()) console.error('Connection status:', await settings.locator('#status').innerText());
  if (remote && !remote.isClosed()) {
    console.error('Remote API responses:', requests.slice(-30));
    console.error('Remote page errors:', pageErrors);
    console.error('Remote UI:', (await remote.locator('body').innerText()).slice(0, 3000));
    await remote.screenshot({ path: join(root, 'artifacts/electron-failure.png') });
  }
  throw error;
} finally {
  if (application) await application.close();
  await host.stop();
}
