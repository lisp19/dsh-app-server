import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer as createHTTPServer } from 'node:http';
import { connect as connectTCP } from 'node:net';
import { once } from 'node:events';
import ssh2 from 'ssh2';
import { openSSHTunnel, validateSSH } from '../src/ssh-tunnel.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
async function fixture(t) {
  const http = createHTTPServer((_req, res) => res.end('forwarded HTTP fixture'));
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const clients = new Set();
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.once('close', () => clients.delete(client));
    client.on('authentication', ctx => {
      if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'fixture-password') ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () => client.on('tcpip', (accept, reject, info) => {
      if (info.destIP !== '127.0.0.1' || info.destPort !== http.address().port) { reject(); return; }
      const socket = connectTCP({ host: info.destIP, port: info.destPort });
      socket.once('connect', () => {
        const channel = accept();
        socket.pipe(channel).pipe(socket);
        channel.on('error', () => socket.destroy());
        channel.once('close', () => socket.destroy());
      });
      socket.on('error', () => socket.destroy());
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const client of clients) client.end();
    http.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => http.close(resolve))]);
  });
  return { ssh: { host: '127.0.0.1', port: server.address().port, username: 'fixture', auth: 'password' }, password: 'fixture-password', targetURL: `http://127.0.0.1:${http.address().port}/` };
}

test('built-in SSH forwards actual HTTP bytes through a verified loopback listener', { timeout: 15000 }, async t => {
  const options = await fixture(t);
  let fingerprint;
  const tunnel = await openSSHTunnel({ ...options, verifyHost: host => { fingerprint = host.fingerprint; return true; } });
  t.after(() => tunnel.close());
  assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]+$/);
  assert.equal(new URL(tunnel.url).hostname, '127.0.0.1');
  assert.equal(await (await fetch(tunnel.url)).text(), 'forwarded HTTP fixture');
  tunnel.close();
});

test('host rejection and wrong SSH password fail closed', { timeout: 15000 }, async t => {
  const options = await fixture(t);
  await assert.rejects(openSSHTunnel({ ...options, verifyHost: () => false }), { code: 'sshHostKey' });
  await assert.rejects(openSSHTunnel({ ...options, password: 'wrong', verifyHost: () => true }), { code: 'sshAuth' });
});

test('cancellation aborts pending host verification', { timeout: 15000 }, async t => {
  const options = await fixture(t);
  const controller = new AbortController();
  let promptSignal;
  const pending = openSSHTunnel({ ...options, signal: controller.signal, verifyHost: (_host, signal) => {
    promptSignal = signal;
    controller.abort();
    return false;
  } });
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(promptSignal.aborted, true);
  assert.throws(() => validateSSH({ ...options.ssh, host: 'host; command' }), { code: 'sshConfig' });
});
