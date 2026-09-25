/** Resolve a manual Electron redirect without ever calling followRedirect(). */
export function exchangeToken(requestFactory, session, url, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const request = requestFactory({ url, session, method: 'GET', redirect: 'manual', useSessionCookies: true,
      cache: 'no-store', referrerPolicy: 'no-referrer' });
    let settled = false;
    const finish = (error, status, rawHeaders) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else {
        const headers = new Headers();
        for (const [name, values] of Object.entries(rawHeaders ?? {})) {
          for (const value of Array.isArray(values) ? values : [values]) if (value !== undefined) headers.append(name, value);
        }
        resolve({ status, headers, body: null });
      }
    };
    const abort = () => { finish(signal.reason); request.abort(); };
    signal.addEventListener('abort', abort, { once: true });
    request.on('redirect', (status, _method, _target, headers) => {
      finish(undefined, status, headers);
      request.abort();
    });
    request.on('response', response => {
      finish(undefined, response.statusCode, response.headers);
      response.resume();
    });
    request.on('error', error => finish(error));
    request.end();
  });
}
