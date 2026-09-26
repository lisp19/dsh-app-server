/** End-to-end Electron SSH transport with an ephemeral in-process SSH fixture. */
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect as connectTCP } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';
import { _electron as electron } from 'playwright';
import { startHarness, root } from './harness.mjs';

const output = join(root, 'artifacts/screenshots');
await mkdir(output, { recursive: true });
const host = await startHarness();
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const hostPublic = ssh2.utils.parseKey(privateKey).getPublicSSH();
const fingerprint = `SHA256:${createHash('sha256').update(hostPublic).digest('base64').replace(/=+$/, '')}`;
const target = new URL(host.base);
const clients = new Set();
const sockets = new Set();
let forwards = 0;
const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
  clients.add(client);
  client.on('error', () => {});
  client.once('close', () => clients.delete(client));
  client.on('authentication', context => {
    if (context.method === 'password' && context.username === 'integration' && context.password === 'ssh-fixture-password') context.accept();
    else context.reject();
  });
  client.on('ready', () => client.on('tcpip', (accept, reject, info) => {
    if (info.destIP !== target.hostname || info.destPort !== Number(target.port)) { reject(); return; }
    forwards++;
    const socket = connectTCP({ host: info.destIP, port: info.destPort });
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.once('connect', () => {
      const channel = accept();
      channel.on('error', () => socket.destroy());
      channel.once('close', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    });
  }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const report = { checkedAt: new Date().toISOString(), upstreamChannel: host.upstreamChannel, upstreamVersion: host.upstreamVersion, checks: [], pageErrors: [] };
let application;
let remote;
let settings;
const frames = [];
try {
  const executablePath = process.env.DSH_ELECTRON_EXECUTABLE;
  application = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : [join(root, 'apps/electron')]), `--user-data-dir=${join(host.run, 'ssh-electron')}`, '--lang=en-US'], timeout: 30000 });
  // Accept only this ephemeral fixture's actual host fingerprint through the normal dialog flow.
  await application.evaluate(({ dialog }, expected) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      if (options.detail?.includes(expected)) return { response: 1, checkboxChecked: false };
      return original(...args);
    };
  }, fingerprint);
  await application.context().routeWebSocket('**/api/remote.mux', client => {
    const upstream = client.connectToServer();
    client.onMessage(message => upstream.send(message));
    upstream.onMessage(message => { frames.push(JSON.parse(message.toString())); client.send(message); });
  });
  settings = await application.firstWindow();
  await settings.locator('#connect').waitFor();
  if (await settings.locator('#remember').isChecked()) await settings.locator('#remember').uncheck();
  await settings.locator('#transport').selectOption('ssh');
  await settings.locator('#server').fill(host.base);
  await settings.locator('#ssh-host').fill('127.0.0.1');
  await settings.locator('#ssh-port').fill(String(server.address().port));
  await settings.locator('#ssh-user').fill('integration');
  await settings.locator('#ssh-auth').selectOption('password');
  await settings.locator('#ssh-password').fill('ssh-fixture-password');
  await settings.locator('#token').fill(host.token);
  const opened = application.waitForEvent('window', { timeout: 30000 });
  await settings.locator('#connect').click();
  remote = await opened;
  remote.on('pageerror', error => report.pageErrors.push(error.message));
  await remote.waitForURL(url => url.hostname === '127.0.0.1' && url.pathname === '/');
  assert.notEqual(new URL(remote.url()).port, target.port);
  assert.equal(await remote.evaluate(() => window.isSecureContext), true);
  assert.equal((await fetch(remote.url())).status, 403, 'Local bridge must reject a caller lacking its private header');
  const info = await remote.evaluate(async () => (await fetch('/api/app-server/info')).json());
  assert.equal(info.protocolVersion, 2);
  assert.equal(info.upstreamVersion, host.upstreamVersion);
  report.checks.push('Electron SSH settings authenticate through a verified ephemeral host key and SSH password');
  report.checks.push('Client localhost bridge reaches authenticated gateway discovery and native GUI through real SSH forwarding');
  await remote.getByRole('button', { name: 'Continue', exact: true }).click();
  await remote.getByRole('button', { name: 'Settings', exact: true }).click();
  const described = remote.waitForResponse(response => response.url().endsWith('/api/credentials/describe') && response.ok());
  await remote.getByRole('button', { name: 'Models', exact: true }).click();
  await described;
  await remote.getByRole('button', { name: 'Edit DeepSeek (deepseek-official)', exact: true }).click();
  await remote.getByPlaceholder('Provided by the launch environment (read-only)', { exact: true }).waitFor();
  report.checks.push('Native provider settings and credentials/describe succeed through the SSH and localhost bridges');
  const deadline = Date.now() + 10000;
  while (!frames.some(frame => frame.value?.type === 'ready') && Date.now() < deadline) await delay(100);
  assert.ok(frames.some(frame => frame.value?.type === 'ready'), 'Native GUI must receive its WebSocket ready stream through SSH');
  assert.deepEqual(report.pageErrors, []);
  assert.ok(forwards > 1);
  report.checks.push('Native remote.mux WebSocket delivers application ready frames through SSH');
  report.forwardedConnections = forwards;
  report.status = 'passed';
  report.limitations = ['Ephemeral ssh2 fixture; system OpenSSH configuration, SSH private-key authentication, and remote-network latency are not exercised.'];
  await remote.screenshot({ path: join(output, 'ssh-native-settings.png') });
  console.log(`SSH integration passed: real Electron, native settings/RPC/WebSocket, npm ${host.upstreamChannel} ${host.upstreamVersion}.`);
} catch (error) {
  report.status = 'failed';
  report.error = error.message.replaceAll(host.token, '[redacted]').replaceAll('ssh-fixture-password', '[redacted]');
  if (settings && !settings.isClosed()) console.error('SSH connection status:', await settings.locator('#status').innerText());
  console.error('Forwarded connection count:', forwards);
  if (remote && !remote.isClosed()) await remote.screenshot({ path: join(output, 'ssh-failure.png') });
  throw error;
} finally {
  await application?.close();
  for (const client of clients) client.destroy();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  await host.stop();
  await writeFile(join(output, 'ssh-integration-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
