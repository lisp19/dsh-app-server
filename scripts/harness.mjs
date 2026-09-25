/** Isolated real-profile launch shared by API and Electron integration checks. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server';
import { unzipSync, strFromU8 } from 'fflate';

export const root = fileURLToPath(new URL('../', import.meta.url));

/** Launch a shipped Web profile with the installed tarball and a deterministic model. */
export async function startHarness({ sequence = ['success'], successText = 'APP_SERVER_INTEGRATION_OK', toolName = 'bash', toolArguments = '{}', chunkDelayMs = 150 } = {}) {
  await mkdir(join(root, '.integration'), { recursive: true });
  const run = await mkdtemp(join(root, '.integration', 'run-'));
  const home = join(run, 'home');
  const workspace = join(run, 'workspace');
  const profile = join(home, 'profiles', 'app-server');
  const installed = join(root, '.integration', 'installation', 'profiles', 'app-server');
  for (const file of ['src/index.js', 'cordis.patch.yml', 'package.json']) {
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
  const model = await startMockLlmServer({ port: 0, sequence, repeatLast: true, successText, toolName, toolArguments, apiKey: 'integration-only', chunkSize: 4, chunkDelayMs });
  const child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'app-server', '--no-open', '--port', '0'], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: 'integration-only', DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError;
  child.once('error', error => { spawnError = error; });
  const capture = chunk => { output = (output + chunk.toString()).slice(-100_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let closed = false;
  const exited = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  const stop = async () => {
    if (!closed) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await model.close();
  };
  try {
    const deadline = Date.now() + 60_000;
    let authenticatedUrl;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (closed) throw new Error(`Harness exited during startup:\n${redact(output)}`);
      authenticatedUrl = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)?.[0];
      if (authenticatedUrl) break;
      await delay(100);
    }
    if (!authenticatedUrl) throw new Error(`Harness startup timed out:\n${redact(output)}`);
    const base = new URL(authenticatedUrl).origin;
    const response = await fetch(authenticatedUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status !== 303) throw new Error(`Token exchange returned ${response.status}`);
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('No authentication cookie');
    return { base, token: new URL(authenticatedUrl).searchParams.get('token'), cookie, run, home, workspace, child, model, stop };
  } catch (error) { await stop(); throw error; }
}

function redact(text) { return text.replace(/([?&]token=)[^\s"']+/g, '$1[redacted]'); }

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
