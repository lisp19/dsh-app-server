/** Prepare a fresh, unmodified npm channel plus a separately installed test helper. */
import { mkdir, mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { installUpstream, parseChannelOption } from './install-upstream.mjs';

const channel = parseChannelOption(process.argv.slice(2)) ?? 'latest';
const root = fileURLToPath(new URL('../', import.meta.url));
const integration = join(root, '.integration');
await mkdir(join(root, 'artifacts'), { recursive: true });
await mkdir(join(integration, 'generations'), { recursive: true });
const generation = await mkdtemp(join(integration, 'generations', `${channel}-`));

async function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run('npm', ['run', 'pack:server']);
const { version } = JSON.parse(await readFile(join(root, 'packages/server/package.json'), 'utf8'));
const installed = await installUpstream({
  channel,
  directory: join(generation, 'upstream'), home: join(generation, 'home'),
  pluginTarball: join(root, 'artifacts', `dsh-app-server-server-${version}.tgz`),
  onLog: message => process.stdout.write(message),
});
const testHelperRoot = join(generation, 'mock-runtime');
await mkdir(testHelperRoot, { mode: 0o700 });
await writeFile(join(testHelperRoot, 'package.json'), JSON.stringify({
  name: 'dsh-app-server-integration-helper', private: true, type: 'module',
  dependencies: { '@deepseek-ai/dsh-llm-mock-server': installed.upstreamVersion },
}, null, 2) + '\n', { mode: 0o600 });
await run('npm', ['install', '--no-audit', '--no-fund'], testHelperRoot);
const metadata = { ...installed, testHelperRoot, preparedAt: new Date().toISOString() };
const pending = join(generation, 'latest-installation.json');
await writeFile(pending, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
await rename(pending, join(integration, 'latest-installation.json'));
console.log(`Prepared unmodified npm ${installed.channel} ${installed.upstreamVersion} in ${generation}`);
