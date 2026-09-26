/** Run an unmodified, independently installed DSH behind our authenticated gateway. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function nativeSession(input) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || !url.searchParams.get('token')) {
    throw new Error('Invalid native bootstrap endpoint');
  }
  let cached;
  let expires = 0;
  let pending;
  return {
    origin: url.origin,
    async cookie() {
      if (cached && Date.now() < expires) return cached;
      if (!pending) pending = (async () => {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
        const location = response.headers.get('location');
        const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
        await response.body?.cancel();
        if (response.status !== 303 || !location || new URL(location, url).href !== `${url.origin}/` || !cookie) {
          throw new Error('Native bootstrap authentication unavailable');
        }
        cached = cookie;
        expires = Date.now() + 60 * 60 * 1000;
        return cached;
      })().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export async function readPassword(filename) {
  const info = await stat(filename);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Password file must belong to this user and have mode 600');
  const password = (await readFile(filename, 'utf8')).trimEnd();
  if (password.length < 8 || password.length > 1024 || password !== password.trim() || /[\r\n\0]/.test(password)) throw new Error('Password file must contain one password of 8–1024 characters');
  return password;
}

export async function startRuntime(config, { password, env = {}, onLog = () => {}, onExit = () => {}, startupTimeoutMs = 90000 } = {}) {
  const { createGateway } = await import('../packages/server/src/gateway.js');
  if (!config.cli || !config.home || !config.workspace || !/^[A-Za-z0-9_-]+$/.test(config.profile ?? '')) throw new Error('Invalid runtime configuration');
  password ??= await readPassword(config.passwordFile);
  const runtimeParent = join(config.home, '.app-server-runtime');
  await mkdir(runtimeParent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(runtimeParent, 'run-'));
  const bootstrapFile = join(directory, 'bootstrap.json');
  const overlay = join(directory, 'native.yml');
  await writeFile(overlay, '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: hmr\n  disabled: true\n', { mode: 0o600 });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(config.node ?? process.execPath, [config.cli, '--profile', config.profile, '--patch', overlay, '--no-open'], {
    cwd: config.workspace,
    env: { ...process.env, ...env, DSH_HOME: config.home, DSH_APP_SERVER_BOOTSTRAP_FILE: bootstrapFile,
      DSH_TELEMETRY_DISABLED: '1', PATH: [dirname(config.node ?? process.execPath), join(root, 'node_modules/.bin'), process.env.PATH].join(delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = false;
  let spawnError;
  let gateway;
  let stopping;
  let output = '';
  child.on('error', error => { spawnError = error; });
  const capture = chunk => {
    output = (output + chunk.toString()).slice(-16000);
    // Native logs can include launch credentials. Never forward startup URLs.
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const closed = new Promise(resolve => child.once('close', code => {
    exited = true;
    if (gateway && !stopping) { void gateway.close(); onExit(code ?? 1); }
    resolve();
  }));
  const close = () => stopping ??= (async () => {
    await gateway?.close();
    if (!exited) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      await closed;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  })();
  try {
    const deadline = Date.now() + startupTimeoutMs;
    let native;
    let bootstrap;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exited) throw new Error('Native DSH exited during startup; verify the installed profile and public plugin capabilities');
      try {
        const info = await stat(bootstrapFile);
        if ((info.mode & 0o077) !== 0) throw new Error('Insecure bootstrap file');
        bootstrap = JSON.parse(await readFile(bootstrapFile, 'utf8'));
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (bootstrap) {
        native ??= nativeSession(bootstrap.url);
        try { await native.cookie(); break; } catch { /* Frontend can register after the plugin. */ }
      }
      await delay(100);
    }
    if (!native || Date.now() >= deadline) throw new Error('Native DSH readiness timed out; required public bootstrap/authentication capabilities are unavailable');
    gateway = await createGateway({
      upstreamURL: native.origin, getUpstreamCookie: () => native.cookie(), password,
      host: config.host ?? '127.0.0.1', port: config.port ?? 0, trustedHosts: config.trustedHosts ?? [],
      upstreamVersion: config.upstreamVersion ?? bootstrap.upstreamVersion,
    });
    onLog(`DSH App Server ready on ${config.host ?? '127.0.0.1'}:${gateway.port}; native DSH ${config.upstreamVersion ?? bootstrap.upstreamVersion ?? 'unknown'} is loopback-only`);
    output = '';
    return { ...gateway, close, child, upstreamOrigin: native.origin, runtimeDirectory: directory };
  } catch (error) {
    // Give only redacted diagnostics on failure; success logs contain no native URL/token.
    onLog(output.replace(/([?&]token=)[^\s"']+/g, '$1[redacted]'));
    await close();
    throw error;
  }
}
