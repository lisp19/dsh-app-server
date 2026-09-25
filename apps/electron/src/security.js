/** URL validation and frame authorization shared by the main process and tests. */
export class ConnectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Accept a root HTTPS origin, or plain HTTP on an explicit loopback host. */
export function parseServerURL(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new ConnectionError('invalidUrl');
  const value = input.trim();
  if (!/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value)) throw new ConnectionError('invalidUrl');
  let url;
  try { url = new URL(value); } catch { throw new ConnectionError('invalidUrl'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ConnectionError('invalidUrl');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ConnectionError('insecureUrl');
  // Reject numeric aliases which WHATWG URL silently converts into loopback.
  const rawHost = value.match(/^https?:\/\/(\[[^\]]+\]|[^:/]+)(?::\d+)?\/?$/i)?.[1]?.toLowerCase();
  if (!rawHost || (url.protocol === 'http:' && rawHost !== url.hostname)) throw new ConnectionError('invalidUrl');
  return url;
}

/** Remote documents may navigate only within the selected HTTP(S) origin. */
export function allowsNavigation(target, origin) {
  try {
    const url = new URL(target);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin;
  } catch { return false; }
}

/** Only the exact local settings main frame may invoke the preload API. */
export function isSettingsSender(event, window, settingsURL) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === settingsURL;
}

/** Convert network failures to stable codes; raw errors can contain the token URL. */
export function errorCode(error) {
  if (error instanceof ConnectionError) return error.code;
  if (/CERT|SSL|TLS/i.test(String(error?.message))) return 'tls';
  return 'network';
}
