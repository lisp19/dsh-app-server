import { ConnectionError, parseServerURL } from './security.js';

/** Validate the versioned server identity before loading its GUI. */
export function validateServerInfo(info) {
  if (!info || info.product !== 'dsh-app-server') throw new ConnectionError('missingPlugin');
  if (![1, 2].includes(info.protocolVersion) || typeof info.platform !== 'string' || !info.platform) throw new ConnectionError('protocol');
  if (info.protocolVersion === 2 && (typeof info.upstreamVersion !== 'string' || !info.upstreamVersion
    || info.capabilities?.http !== true || info.capabilities?.websocket !== true || info.capabilities?.passwordLogin !== true)) throw new ConnectionError('protocol');
  return info;
}

/** Exchange a token without following redirects, using only this connection's session. */
export async function authenticate(session, input, token, signal, exchange = (url, options) => session.fetch(url, options)) {
  const url = parseServerURL(input);
  if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token)) throw new ConnectionError('invalidToken');
  const login = new URL(url);
  login.searchParams.set('token', token.trim());
  const options = { redirect: 'manual', credentials: 'include', cache: 'no-store', signal };
  const response = await exchange(login.href, options);
  if ([401, 403].includes(response.status)) throw new ConnectionError('auth');
  if (response.status !== 303) throw new ConnectionError('auth');
  const location = response.headers.get('location');
  let redirect;
  try { redirect = new URL(location, url); } catch { throw new ConnectionError('auth'); }
  if (!location || redirect.href !== url.href) throw new ConnectionError('auth');
  await response.body?.cancel();
  const cookies = await session.cookies.get({ url: url.href });
  if (!cookies.length) throw new ConnectionError('auth');
  const infoResponse = await session.fetch(new URL('/api/app-server/info', url).href, options);
  if ([401, 403].includes(infoResponse.status)) throw new ConnectionError('auth');
  if (infoResponse.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(infoResponse.headers.get('content-type') ?? '')) throw new ConnectionError('missingPlugin');
  let info;
  try { info = await infoResponse.json(); } catch { throw new ConnectionError('missingPlugin'); }
  validateServerInfo(info);
  signal.throwIfAborted();
  return { url, info };
}

/** Latest attempt wins; abort and timeout settle even if an operation ignores its signal. */
export class ConnectionAttempts {
  #current;
  cancel(reason = new ConnectionError('cancelled')) {
    this.#current?.abort(reason);
    this.#current = undefined;
  }
  async run(operation, timeoutMs = 20000) {
    this.cancel();
    const controller = new AbortController();
    this.#current = controller;
    const timer = setTimeout(() => controller.abort(new ConnectionError('timeout')), timeoutMs);
    let onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }),
        new Promise((_, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (this.#current === controller) this.#current = undefined;
    }
  }
}
