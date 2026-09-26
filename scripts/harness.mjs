/** Isolated real-profile launch shared by API and Electron integration checks. */
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { startRuntime } from './runtime.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));

/** Launch a shipped Web profile with the installed tarball and a deterministic model. */
export async function startHarness({ sequence = ['success'], successText = 'APP_SERVER_INTEGRATION_OK', toolName = 'bash', toolArguments = '{}', chunkDelayMs = 150, gatewayHost = '127.0.0.1' } = {}) {
  await mkdir(join(root, '.integration'), { recursive: true });
  const run = await mkdtemp(join(root, '.integration', 'run-'));
  const home = join(run, 'home');
  const workspace = join(run, 'workspace');
  const profile = join(home, 'profiles', 'app-server');
  let metadata;
  try { metadata = JSON.parse(await readFile(join(root, '.integration/latest-installation.json'), 'utf8')); }
  catch (error) { throw new Error('No prepared upstream installation. Run npm run prepare:integration.', { cause: error }); }
  const installed = join(metadata.home, 'profiles', metadata.profile);
  for (const file of ['src/index.js', 'src/gateway.js', 'cordis.patch.yml', 'package.json']) {
    const current = await readFile(join(root, 'packages/server', file), 'utf8');
    const packed = await readFile(join(installed, 'node_modules/@dsh-app-server/server', file), 'utf8');
    if (current !== packed) throw new Error('Installed plugin differs from source. Run npm run prepare:integration.');
  }
  await mkdir(profile, { recursive: true });
  await mkdir(workspace);
  await writeFile(join(profile, 'package.json'), await readFile(join(installed, 'package.json')));
  await symlink(join(installed, 'node_modules'), join(profile, 'node_modules'), 'dir');
  await writeFile(join(profile, 'cordis.patch.yml'), [
    '- id: hmr', '  disabled: true',
    '- id: session-title-llm', '  disabled: true',
    '- id: ui-settings-models', '  config:', '    credentialOnboarding: false',
    '- id: workspace-controller', '  config:', `    documentsDirectory: ${JSON.stringify(join(run, 'documents'))}`,
    '',
  ].join('\n'));
  const helperRequire = createRequire(join(metadata.testHelperRoot, 'package.json'));
  const { startMockLlmServer } = await import(pathToFileURL(helperRequire.resolve('@deepseek-ai/dsh-llm-mock-server')).href);
  const model = await startMockLlmServer({ port: 0, sequence, repeatLast: true, successText, toolName, toolArguments, apiKey: 'integration-only', chunkSize: 4, chunkDelayMs });
  const token = 'integration-only-password';
  const runtimeConfig = {
    cli: metadata.cli, node: metadata.node, home, profile: 'app-server', workspace,
    host: gatewayHost, port: 0, upstreamVersion: metadata.upstreamVersion,
  };
  let gateway;
  const stop = async () => {
    try { await gateway?.close(); } finally { await model.close(); }
  };
  try {
    gateway = await startRuntime(runtimeConfig, { password: token, env: { DEEPSEEK_API_KEY: 'integration-only', DEEPSEEK_BASE_URL: `${model.baseURL}/v1` },
      onLog: message => process.stderr.write(`${message}\n`),
    });
    const address = gatewayHost === '0.0.0.0'
      ? Object.values(networkInterfaces()).flat().find(value => value && !value.internal && value.family === 'IPv4')?.address
      : gatewayHost;
    if (!address) throw new Error('No non-loopback IPv4 interface available for remote integration');
    const base = gatewayHost === '0.0.0.0' ? `http://${address}:${gateway.port}` : gateway.url;
    const authenticatedUrl = `${base}/?token=${encodeURIComponent(token)}`;
    const response = await fetch(authenticatedUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status !== 303) throw new Error(`Token exchange returned ${response.status}`);
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('No authentication cookie');
    return { base, token, cookie, run, home, workspace, child: gateway.child, model, stop,
      upstreamOrigin: gateway.upstreamOrigin, upstreamVersion: metadata.upstreamVersion, upstreamChannel: metadata.channel ?? 'latest',
      runtimeConfig, gatewayClose: gateway.close };
  } catch (error) { await stop(); throw error; }
}

/** Invoke the shipped GUI RPC carrier with a named request parameter. */
export async function rpc(host, method, request) {
  const rpcId = crypto.randomUUID();
  const response = await fetch(`${host.base}/api/${method}`, {
    signal: AbortSignal.timeout(30_000),
    method: 'POST', headers: { cookie: host.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const envelope = await response.json();
  if (!envelope.result.ok) throw new Error(`${method}: ${JSON.stringify(envelope.result.error)}`);
  return envelope.result.value;
}

/** Read a flushed durable log through the same export endpoint the GUI uses. */
export async function readSessionLog(host, sessionId) {
  const response = await fetch(`${host.base}/api/session.export?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { cookie: host.cookie }, signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) throw new Error(`Session export returned ${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entry = Object.entries(entries).find(([name]) => name.endsWith('.jsonl'));
  if (!entry) throw new Error('Session export contains no log');
  return strFromU8(entry[1]).trim().split('\n').map(line => JSON.parse(line));
}
