import http from 'node:http';
import https from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function cleanHeaders(headers) {
  const excluded = new Set([...hopHeaders, ...(headers.connection ?? '').toLowerCase().split(',').map(v => v.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key)));
}

/** A connection-scoped, authenticated localhost transport; never modifies upstream content. */
export async function createLocalBridge({ upstreamURL, getCookies, signal }) {
  const upstream = new URL(upstreamURL);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Invalid upstream');
  const secret = randomBytes(32).toString('hex');
  const headerName = 'x-dsh-local-bridge';
  const sockets = new Set();
  const requests = new Set();
  let local;
  let closed = false;
  const track = socket => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const valid = req => {
    const supplied = req.headers[headerName];
    return !closed && typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
      && req.headers.host === local.host
      && (!req.headers.origin || req.headers.origin === local.origin)
      && (!req.headers['sec-fetch-site'] || ['none', 'same-origin'].includes(req.headers['sec-fetch-site']))
      && req.url.startsWith('/') && !req.url.startsWith('//') && !req.url.includes('\\')
      && !['CONNECT', 'TRACE'].includes(req.method);
  };
  const responseHeaders = headers => {
    const result = cleanHeaders(headers);
    delete result['set-cookie'];
    delete result['set-cookie2'];
    delete result['alt-svc'];
    if (result.location) {
      const target = new URL(result.location, upstream);
      if (target.origin !== upstream.origin || target.username || target.password) throw new Error('External redirect');
      const destination = new URL(local);
      destination.pathname = target.pathname;
      destination.search = target.search;
      destination.hash = target.hash;
      result.location = destination.href;
    }
    // Refresh can trigger navigation outside normal HTTP redirect handling.
    delete result.refresh;
    return result;
  };
  const forward = async (req, downstream, head) => {
    const websocket = head !== undefined;
    const fail = code => {
      if (websocket) downstream.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      else if (!downstream.headersSent) { downstream.writeHead(code); downstream.end(); }
      else downstream.destroy();
    };
    if (!valid(req) || (websocket && req.headers.upgrade?.toLowerCase() !== 'websocket')) return fail(403);
    try {
      const target = new URL(upstream.origin);
      // Keep the request path verbatim: it is never interpreted as an upstream authority.
      const cookies = await getCookies(new URL(req.url, upstream).href);
      if (closed || downstream.destroyed) return;
      const headers = cleanHeaders(req.headers);
      for (const key of Object.keys(headers)) {
        if (key === headerName || ['cookie', 'authorization', 'host', 'origin', 'referer', 'forwarded'].includes(key)
          || key.startsWith('x-forwarded-') || key.startsWith('proxy-')) delete headers[key];
      }
      headers.host = upstream.host;
      if (req.headers.origin) headers.origin = upstream.origin;
      if (cookies.length) headers.cookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      if (websocket) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket'; }
      const request = (upstream.protocol === 'https:' ? https : http).request(target, { method: req.method, path: req.url, headers });
      requests.add(request);
      request.once('close', () => requests.delete(request));
      request.on('socket', track);
      request.on('error', () => fail(502));
      downstream.once('close', () => request.destroy());
      request.on('response', response => {
        if (websocket) { response.destroy(); fail(response.statusCode === 401 ? 401 : 502); return; }
        try { downstream.writeHead(response.statusCode, responseHeaders(response.headers)); }
        catch { response.destroy(); fail(502); return; }
        response.on('error', () => downstream.destroy());
        response.pipe(downstream);
      });
      request.on('upgrade', (response, socket, upstreamHead) => {
        if (!websocket) { socket.destroy(); fail(502); return; }
        let headers;
        try { headers = responseHeaders(response.headers); } catch { socket.destroy(); fail(502); return; }
        headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
        downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(v => `${key}: ${v}\r\n`)).join('')}\r\n`);
        if (upstreamHead.length) downstream.write(upstreamHead);
        if (head.length) socket.write(head);
        socket.on('error', () => downstream.destroy());
        downstream.on('error', () => socket.destroy());
        downstream.once('close', () => socket.destroy());
        socket.once('close', () => downstream.destroy());
        socket.pipe(downstream); downstream.pipe(socket);
      });
      req.on('aborted', () => request.destroy());
      req.pipe(request);
    } catch { fail(502); }
  };
  const server = http.createServer((req, res) => { void forward(req, res); });
  server.on('connection', track);
  server.on('upgrade', (req, socket, head) => { void forward(req, socket, head); });
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
  server.on('clientError', (_error, socket) => socket.destroy());
  const close = () => {
    closed = true;
    signal?.removeEventListener('abort', close);
    for (const request of requests) request.destroy();
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  local = new URL(`http://127.0.0.1:${server.address().port}/`);
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) { close(); signal.throwIfAborted(); }
  return { url: local.href, headerName, secret, close };
}
