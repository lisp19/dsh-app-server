import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import ssh2 from 'ssh2';
import { ConnectionError, parseServerURL } from './security.js';

/** Return only persistable, public SSH settings. */
export function validateSSH(input) {
  const invalid = () => { throw new ConnectionError('sshConfig'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (typeof input.host !== 'string' || typeof input.username !== 'string') invalid();
  const host = input.host.trim().toLowerCase();
  const username = input.username.trim();
  if (!['number', 'string', 'undefined'].includes(typeof input.port)
    || (typeof input.port === 'string' && input.port !== '' && !/^\d{1,5}$/.test(input.port))) invalid();
  const port = input.port === undefined || input.port === '' ? 22 : Number(input.port);
  if (!host || host.length > 253 || (!isIP(host) && !host.split('.').every(
    label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  ))) invalid();
  if (!username || username.length > 255 || /[\s\x00-\x1f\x7f]/.test(username)) invalid();
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid();
  if (!['password', 'key'].includes(input.auth)) invalid();
  const config = { host, port, username, auth: input.auth };
  if (input.auth === 'key') {
    if (typeof input.privateKeyPath !== 'string' || !isAbsolute(input.privateKeyPath)
      || input.privateKeyPath.length > 4096 || /[\x00-\x1f\x7f]/.test(input.privateKeyPath)) invalid();
    config.privateKeyPath = input.privateKeyPath;
  }
  return config;
}

/** Forward HTTP and WebSocket bytes through a verified SSH connection. */
export async function openSSHTunnel({ ssh, password, passphrase, targetURL, signal, verifyHost, onDisconnect }) {
  const config = validateSSH(ssh);
  let target;
  try {
    target = parseServerURL(targetURL instanceof URL ? targetURL.href : targetURL);
    if (target.protocol !== 'http:') throw new Error();
  } catch { throw new ConnectionError('sshConfig'); }
  if (typeof verifyHost !== 'function') throw new ConnectionError('sshHostKey');
  const abortError = () => signal?.reason instanceof ConnectionError ? signal.reason : new ConnectionError('cancelled');
  if (signal?.aborted) throw abortError();
  let privateKey;
  if (config.auth === 'password') {
    if (typeof password !== 'string' || !password || password.length > 8192) throw new ConnectionError('sshAuth');
  } else {
    if (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > 8192)) throw new ConnectionError('sshAuth');
    try {
      privateKey = await readFile(config.privateKeyPath, { signal });
      const parsed = ssh2.utils.parseKey(privateKey, passphrase || undefined);
      const key = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!key || key instanceof Error || !key.isPrivateKey()) throw new Error();
    } catch {
      if (signal?.aborted) throw abortError();
      throw new ConnectionError('sshAuth');
    }
  }
  if (signal?.aborted) throw abortError();

  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    const sockets = new Set();
    const channels = new Set();
    let stopped = false;
    let opened = false;
    let hostRejected = false;
    const listenerAbort = new AbortController();
    const verificationAbort = new AbortController();
    const server = createServer({ allowHalfOpen: true }, socket => {
      if (stopped) { socket.destroy(); return; }
      sockets.add(socket);
      socket.on('error', () => socket.destroy());
      socket.once('close', () => sockets.delete(socket));
      socket.pause();
      try {
        client.forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0,
          target.hostname.replace(/^\[|\]$/g, ''), Number(target.port || 80), (error, channel) => {
            if (stopped || socket.destroyed) { channel?.destroy(); return; }
            if (error) { fail(new ConnectionError('sshNetwork')); return; }
            channels.add(channel);
            channel.on('error', () => { channel.destroy(); socket.destroy(); });
            channel.once('close', () => { channels.delete(channel); socket.destroy(); });
            socket.once('close', () => channel.destroy());
            socket.pipe(channel).pipe(socket);
            socket.resume();
          });
      } catch { fail(new ConnectionError('sshNetwork')); }
    });

    // Abortable listen also cancels a bind which has not emitted 'listening' yet.
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      verificationAbort.abort();
      signal?.removeEventListener('abort', onAbort);
      listenerAbort.abort();
      for (const socket of sockets) socket.destroy();
      for (const channel of channels) channel.destroy();
      sockets.clear();
      channels.clear();
      client.destroy();
    };
    const fail = error => {
      if (stopped) return;
      dispose();
      if (!opened) reject(error);
      else {
        // Consumer callbacks cannot turn an SSH event into an uncaught exception.
        Promise.resolve().then(() => onDisconnect?.(error)).catch(() => {});
      }
    };
    const onAbort = () => {
      if (stopped) return;
      dispose();
      if (!opened) reject(abortError());
    };
    const close = () => {
      dispose();
      if (!opened) reject(new ConnectionError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }

    server.on('error', () => fail(new ConnectionError('sshNetwork')));
    server.on('close', () => { if (!stopped) fail(new ConnectionError('sshNetwork')); });
    client.on('error', error => fail(new ConnectionError(hostRejected ? 'sshHostKey'
      : error.level === 'client-authentication' ? 'sshAuth' : 'sshNetwork')));
    client.on('end', () => fail(new ConnectionError('sshNetwork')));
    client.on('close', () => fail(new ConnectionError('sshNetwork')));
    client.once('ready', () => {
      if (stopped) return;
      try {
        server.listen({ host: '127.0.0.1', port: 0, signal: listenerAbort.signal }, () => {
          if (stopped) { server.close(); return; }
          opened = true;
          resolve({ url: `http://127.0.0.1:${server.address().port}/`, close });
        });
      } catch { fail(new ConnectionError('sshNetwork')); }
    });
    try {
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        ...(config.auth === 'password' ? { password } : { privateKey, passphrase: passphrase || undefined }),
        // Do not try agent, keyboard-interactive, or other implicit identities.
        authHandler: [config.auth === 'password' ? 'password' : 'publickey'],
        readyTimeout: 60000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key, callback) => {
          const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          Promise.resolve().then(() => stopped ? false : verifyHost({ host: config.host, port: config.port, fingerprint }, verificationAbort.signal))
            .then(accepted => {
              if (stopped) return;
              hostRejected = accepted !== true;
              callback(!hostRejected);
              if (hostRejected) fail(new ConnectionError('sshHostKey'));
            }).catch(() => {
              if (stopped) return;
              hostRejected = true;
              callback(false);
              fail(new ConnectionError('sshHostKey'));
            });
        },
      });
    } catch { fail(new ConnectionError('sshConfig')); }
  });
}
