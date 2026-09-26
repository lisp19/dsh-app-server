import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 4096;
const COOKIE = 'dsh_app_session';
const hash = value => createHash('sha256').update(value).digest();
const unbracket = value => value.replace(/^\[|\]$/g, '');
const loopback = value => value === '::1' || (isIP(value) === 4 && value.startsWith('127.'));
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function cleanHeaders(headers) {
  const result = { ...headers };
  for (const key of [...hopHeaders, ...(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]) delete result[key];
  for (const key of Object.keys(result)) {
    if (key === 'forwarded' || key.startsWith('x-forwarded-') || key.startsWith('proxy-')) delete result[key];
  }
  return result;
}

/** Authenticate an independent browser session before forwarding to a private DSH Host. */
export async function createGateway({ upstreamURL, upstreamCookie, getUpstreamCookie, password, host = '127.0.0.1', port = 0, trustedHosts = [], upstreamVersion }) {
  const upstream = new URL(upstreamURL);
  if (upstream.protocol !== 'http:' || !loopback(unbracket(upstream.hostname)) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('Gateway upstream must be an HTTP literal loopback origin');
  }
  if (typeof password !== 'string' || !password.trim()) throw new Error('Gateway password must be nonempty');
  const validCookie = value => typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value);
  if (typeof getUpstreamCookie !== 'function' && !validCookie(upstreamCookie)) throw new Error('Missing upstream cookie');
  const passwordHash = hash(password);
  const localAddresses = new Set(Object.values(networkInterfaces()).flat().map(info => info.address));
  const trusted = new Set(trustedHosts.map(value => value.toLowerCase()));
  const sessions = new Map();
  const attempts = new Map();
  const sockets = new Set();
  const requests = new Set();
  const trackSocket = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  };

  function guard(req) {
    const authority = req.headers.host;
    if (!authority || !/^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?$/.test(authority)) return false;
    let parsed;
    try { parsed = new URL(`http://${authority}`); } catch { return false; }
    const hostname = unbracket(parsed.hostname);
    const rawHostname = authority.startsWith('[') ? authority.slice(1, authority.indexOf(']')) : authority.split(':')[0];
    // URL parsing accepts abbreviated and encoded IPv4; trust only literal addresses.
    if (isIP(hostname) && !isIP(rawHostname)) return false;
    if (!loopback(hostname) && !localAddresses.has(hostname) && !trusted.has(hostname) && !trusted.has(authority.toLowerCase())) return false;
    if (req.headers.origin && req.headers.origin !== parsed.origin) return false;
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
    return parsed.host;
  }

  function authenticated(req, authority) {
    const pairs = (req.headers.cookie || '').split(';').map(value => value.trim());
    const values = pairs.filter(value => value.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return false;
    const token = values[0].slice(COOKIE.length + 1);
    const session = sessions.get(token);
    if (!session || session.authority !== authority || session.expires <= Date.now()) {
      if (session?.expires <= Date.now()) sessions.delete(token);
      return false;
    }
    return true;
  }

  function outgoingHeaders(req, upgrade, cookie) {
    const headers = cleanHeaders(req.headers);
    delete headers.authorization;
    delete headers.cookie;
    headers.host = upstream.host;
    headers.cookie = cookie;
    if (headers.origin) headers.origin = upstream.origin;
    if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket'; }
    return headers;
  }

  function responseHeaders(response) {
    const headers = cleanHeaders(response.headers);
    delete headers['set-cookie'];
    if (headers.location) {
      const target = new URL(headers.location, upstream);
      if (target.origin !== upstream.origin || target.username || target.password) throw new Error('External upstream redirect');
      // A double-leading slash would turn a relative redirect into an authority.
      headers.location = `/${target.pathname.replace(/^\/+/, '')}${target.search}${target.hash}`;
    }
    return headers;
  }

  const reply = (res, status, message = http.STATUS_CODES[status]) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(message);
  };
  async function proxy(req, res, head) {
    const upgrading = head !== undefined;
    let cookie;
    try {
      cookie = getUpstreamCookie ? await getUpstreamCookie() : upstreamCookie;
      if (!validCookie(cookie)) throw new Error('Invalid upstream cookie');
    } catch {
      if (upgrading) res.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      else reply(res, 502);
      return;
    }
    if (res.destroyed) return;
    const pending = http.request({ hostname: unbracket(upstream.hostname), port: upstream.port || 80, method: req.method, path: req.url, headers: outgoingHeaders(req, upgrading, cookie), agent: false });
    requests.add(pending);
    pending.once('close', () => requests.delete(pending));
    pending.on('error', () => {
      if (upgrading) res.destroy();
      else if (!res.headersSent) reply(res, 502);
      else res.destroy();
    });
    req.once('aborted', () => pending.destroy());
    res.once('close', () => pending.destroy());
    pending.on('response', response => {
      let headers;
      try { headers = responseHeaders(response); } catch {
        response.destroy();
        if (upgrading) res.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        else reply(res, 502);
        return;
      }
      if (upgrading) {
        res.end(`HTTP/1.1 ${response.statusCode} ${http.STATUS_CODES[response.statusCode] || 'Error'}\r\nConnection: close\r\n\r\n`);
        response.resume();
      } else {
        res.writeHead(response.statusCode, headers);
        response.on('error', () => res.destroy());
        response.pipe(res);
      }
    });
    pending.on('upgrade', (response, socket, upstreamHead) => {
      trackSocket(socket);
      let headers;
      try { headers = responseHeaders(response); } catch { socket.destroy(); res.destroy(); return; }
      headers.connection = 'Upgrade';
      headers.upgrade = 'websocket';
      res.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)).join('')}\r\n`);
      if (head.length) socket.write(head);
      if (upstreamHead.length) res.write(upstreamHead);
      socket.once('close', () => res.destroy());
      res.once('close', () => socket.destroy());
      socket.pipe(res).pipe(socket);
    });
    if (upgrading) pending.end();
    else req.pipe(pending);
  }

  const server = http.createServer((req, res) => {
    const authority = guard(req);
    if (!authority || !req.url.startsWith('/') || req.url.startsWith('//')) return reply(res, 403);
    const url = new URL(req.url, 'http://gateway.invalid');
    if (url.pathname === '/' && url.searchParams.has('token')) {
      if (req.method !== 'GET') return reply(res, 405);
      const now = Date.now();
      const key = req.socket.remoteAddress;
      const attempt = attempts.get(key);
      if (attempt?.expires > now && attempt.count >= 20) return reply(res, 429);
      if (attempts.size >= 1024 && !attempts.has(key)) attempts.delete(attempts.keys().next().value);
      attempts.set(key, { count: attempt?.expires > now ? attempt.count + 1 : 1, expires: attempt?.expires > now ? attempt.expires : now + 60000 });
      if (!timingSafeEqual(hash(url.searchParams.get('token')), passwordHash)) return reply(res, 401);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { authority, expires: now + SESSION_TTL });
      res.writeHead(303, { location: './', 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (!authenticated(req, authority)) return reply(res, 401);
    if (url.pathname === '/api/app-server/info' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ product: 'dsh-app-server', protocolVersion: 2, platform: process.platform, upstreamVersion, capabilities: { passwordLogin: true, http: true, websocket: true } }));
    }
    proxy(req, res);
  });
  server.on('connection', trackSocket);
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.on('upgrade', (req, socket, head) => {
    const authority = guard(req);
    const status = !authority || !req.url.startsWith('/') || req.url.startsWith('//') ? 403 : !authenticated(req, authority) ? 401 : req.headers.upgrade?.toLowerCase() !== 'websocket' ? 400 : 0;
    if (status) return socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\n\r\n`);
    proxy(req, socket, head);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const boundPort = server.address().port;
  let closing;
  return {
    url: `http://${isIP(host) === 6 ? `[${host}]` : host}:${boundPort}`,
    port: boundPort,
    close() {
      if (!closing) closing = new Promise(resolve => {
        sessions.clear();
        attempts.clear();
        for (const request of requests) request.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      });
      return closing;
    },
  };
}
