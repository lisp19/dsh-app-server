/** Install the release plugin into a dedicated local acceptance profile. */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, delimiter, dirname } from 'node:path';
import { root } from './harness.mjs';

if (process.platform !== 'linux') throw new Error('Local acceptance installation requires Linux. See README for other deployments.');
const directory = join(root, '.acceptance');
const home = join(directory, 'home');
const workspace = join(directory, 'workspace');
const profile = join(home, 'profiles/app-server');
const { version } = JSON.parse(await readFile(join(root, 'packages/server/package.json'), 'utf8'));
const tarball = join(root, 'artifacts', `dsh-app-server-server-${version}.tgz`);
await stat(tarball);
await mkdir(workspace, { recursive: true });
const cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const executablePath = [dirname(process.execPath), join(root, 'node_modules/.bin'), process.env.PATH].join(delimiter);
const env = { ...process.env, DSH_HOME: home, PATH: executablePath };
async function run(args, quiet = false) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: workspace, env, stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`dsh exited ${code}`)));
  });
}
try { await stat(join(profile, 'package.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await run(['--profile', 'app-server', '--from-default-profile', 'web', '--dump-config'], true);
}
await run(['plugin', '--profile', 'app-server', 'add', tarball]);
// User-owned overlays and model credentials survive repeated plugin installation.
try { await stat(join(profile, 'cordis.patch.yml')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: hmr\n  disabled: true\n- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(directory, 'documents'))}\n`, { flag: 'wx' });
}
console.log(`Installed app-server ${version}. DSH_HOME=${home}`);
console.log(`Start with: DSH_HOME=${JSON.stringify(home)} ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} --profile app-server --no-open --port 3080`);
