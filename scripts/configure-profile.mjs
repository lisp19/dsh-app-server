/** Apply version-pinned compatibility patches to a dedicated local Harness profile. */
import { readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const argument = process.argv[2];
if (!argument || process.argv.length !== 3) throw new Error('Usage: node scripts/configure-profile.mjs /absolute/path/server.json');
const config = JSON.parse(await readFile(resolve(argument), 'utf8'));
if (!/^[A-Za-z0-9_-]+$/.test(config.profile ?? '')) throw new Error('Invalid profile');
const profile = join(config.home, 'profiles', config.profile);
const root = fileURLToPath(new URL('../', import.meta.url));
const pnpm = join(root, 'node_modules/pnpm/bin/pnpm.cjs');
const env = { ...process.env, DSH_HOME: config.home, PATH: [dirname(config.node), join(root, 'node_modules/.bin'), process.env.PATH].join(delimiter) };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: profile, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const changes = [
  { name: '@deepseek-ai/dsh-client-ui-settings', file: 'lib/client.js', patch: 'remote-settings.patch', marker: 'App-server operators configure the authenticated Host.' },
  { name: '@deepseek-ai/dsh-client-connection', file: 'lib/index.js', patch: 'fixed-login-password.patch', marker: 'App-server fixed-password file v2.' },
];
const version = '0.1.7-rc.2';
const manifestPath = join(profile, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const backups = join(profile, '.app-server-backup');
await mkdir(backups, { recursive: true, mode: 0o700 });
for (const filename of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  try { await copyFile(join(profile, filename), join(backups, filename), constants.COPYFILE_EXCL); }
  catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
}
const missing = changes.filter(change => manifest.dependencies?.[change.name] !== version);
if (missing.length) run(config.node, [config.cli, 'plugin', '--profile', config.profile, 'add', ...missing.map(change => `${change.name}@${version}`)]);
const require = createRequire(manifestPath);
for (const change of changes) {
  const packagePath = dirname(require.resolve(`${change.name}/package.json`));
  const installed = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
  if (installed.version !== version) throw new Error(`Unsupported ${change.name} version ${installed.version}`);
  if ((await readFile(join(packagePath, change.file), 'utf8')).includes(change.marker)) {
    console.log(`${change.name}: compatibility patch already installed`);
    continue;
  }
  const editDirectory = await mkdtemp(join(tmpdir(), 'dsh-profile-patch-'));
  run(config.node, [pnpm, 'patch', `${change.name}@${version}`, '--ignore-existing', '--edit-dir', editDirectory]);
  run('patch', ['--batch', '--forward', '-p1', '--directory', editDirectory, '--input', join(root, 'compat', change.patch)]);
  run(config.node, [pnpm, 'patch-commit', editDirectory, '--patches-dir', 'patches']);
}
console.log('Profile compatibility patches installed. Restart the systemd service to load them.');
