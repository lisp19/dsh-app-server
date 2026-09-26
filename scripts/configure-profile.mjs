/** Stage an unmodified latest DSH installation; never edit upstream package files. */
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { installUpstream } from './install-upstream.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/configure-profile.mjs /absolute/path/server.json');
const filename = resolve(process.argv[2]);
const config = JSON.parse(await readFile(filename, 'utf8'));
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'packages/server/package.json'), 'utf8'));
const base = config.profileBase ?? config.profile ?? 'app-server';
if (!/^[A-Za-z0-9_-]+$/.test(base)) throw new Error('Invalid profile name');
const generation = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const directory = join(config.home, '.app-server-installations', generation);
const profile = `${base}-${generation}`;
const previousProfile = config.profile && join(config.home, 'profiles', config.profile);
const installed = await installUpstream({ directory, home: config.home, profile,
  pluginTarball: config.pluginTarball ?? join(root, 'artifacts', `dsh-app-server-server-${version}.tgz`) });
// Preserve the user's overlay, never their old dependency graph or package patches.
if (previousProfile) {
  const overlay = join(previousProfile, 'cordis.patch.yml');
  try { await stat(overlay); await copyFile(overlay, join(config.home, 'profiles', profile, 'cordis.patch.yml')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!config.passwordFile) {
  config.passwordFile = join(config.home, '.app-server-password');
  await mkdir(config.home, { recursive: true, mode: 0o700 });
  try { await writeFile(config.passwordFile, randomBytes(32).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
await copyFile(filename, `${filename}.previous`);
await writeFile(filename, JSON.stringify({ ...config, node: installed.node, cli: installed.cli, profile,
  profileBase: base, upstreamVersion: installed.upstreamVersion, installation: directory,
  resolvedAt: installed.resolvedAt }, null, 2) + '\n', { mode: 0o600 });
console.log(`Staged npm latest DSH ${installed.upstreamVersion}. Password file: ${config.passwordFile}`);
console.log('Previous configuration and profile are retained; custom plugin dependencies are not automatically migrated.');
