/** Install the packed plugin through the supported profile-management CLI. */
import { mkdir, stat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = join(root, '.integration', 'installation');
await mkdir(join(root, 'artifacts'), { recursive: true });
const env = { ...process.env, DSH_HOME: home, PATH: join(root, 'node_modules', '.bin') + delimiter + process.env.PATH };

async function run(command, args, quiet = false) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

await run('npm', ['run', 'pack:server']);
const cli = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
try { await stat(join(home, 'profiles', 'app-server', 'package.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await run(process.execPath, [cli, '--profile', 'app-server', '--from-default-profile', 'web', '--dump-config'], true);
}
const { version } = JSON.parse(await readFile(join(root, 'packages/server/package.json'), 'utf8'));
await run(process.execPath, [cli, 'plugin', '--profile', 'app-server', 'add', join(root, 'artifacts', `dsh-app-server-server-${version}.tgz`)]);
console.log('Packed plugin installed in .integration/installation.');
