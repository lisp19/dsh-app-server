/** Install unmodified npm latest and compose a fresh profile using DSH's public CLI. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const nativeAdditions = ['@deepseek-ai/dsh-host-directory-picker-browse', '@deepseek-ai/dsh-client-ui-directory-picker-browse'];

function validate(options) {
  for (const key of ['directory', 'home', 'pluginTarball']) {
    if (typeof options[key] !== 'string' || !isAbsolute(options[key])) throw new Error(`${key} is required and must be an absolute path`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.profile)) throw new Error('profile must be a simple profile name');
}

export function parseInstallerArgs(args) {
  const options = { profile: 'app-server' };
  const keys = { '--directory': 'directory', '--home': 'home', '--profile': 'profile', '--plugin': 'pluginTarball' };
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]];
    if (!key) throw new Error(`Unknown option: ${args[index]}`);
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${args[index]}`);
    options[key] = args[index + 1];
  }
  validate(options);
  return options;
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function runCommand(command, args, { cwd, env, onLog, quiet = false }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; if (!quiet) onLog?.(chunk.toString()); });
    child.stderr.on('data', (chunk) => onLog?.(chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun(stdout) : reject(new Error(`${command} failed (${signal || code}); see installer output`)));
  });
}

async function lockMetadata(path) {
  const bytes = await readFile(path);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function installUpstream({ directory, home, profile = 'app-server', pluginTarball, onLog }, { run = runCommand } = {}) {
  validate({ directory, home, profile, pluginTarball });
  directory = resolve(directory);
  home = resolve(home);
  pluginTarball = resolve(pluginTarball);
  if (await exists(directory)) throw new Error(`Installation already exists: ${directory}; choose a fresh installation directory`);
  if (!(await lstat(pluginTarball)).isFile()) throw new Error('pluginTarball must be a file');
  const profileDirectory = join(home, 'profiles', profile);
  if (await exists(profileDirectory)) {
    const manifestPath = join(profileDirectory, 'package.json');
    if (await exists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (Object.keys(manifest.pnpm?.patchedDependencies || {}).length) throw new Error('Existing profile has patchedDependencies; choose a fresh DSH home');
    }
    throw new Error(`Profile already exists: ${profileDirectory}; choose a fresh DSH home or profile`);
  }
  const env = { ...process.env, DSH_HOME: home, PATH: join(projectRoot, 'node_modules', '.bin') + delimiter + (process.env.PATH || '') };
  const context = { cwd: projectRoot, env, onLog };
  const upstreamVersion = JSON.parse(await run('npm', ['view', '@deepseek-ai/dsh@latest', 'version', '--json'], { ...context, quiet: true }));
  if (typeof upstreamVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(upstreamVersion)) throw new Error('npm latest returned an invalid upstream version');
  const resolvedAt = new Date().toISOString();
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'dsh-app-server-upstream', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': upstreamVersion } }, null, 2) + '\n', { mode: 0o600 });
  await run('npm', ['install', '--no-audit', '--no-fund'], { ...context, cwd: directory });
  const packageDirectory = join(directory, 'node_modules', '@deepseek-ai', 'dsh');
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  if (manifest.version !== upstreamVersion) throw new Error('Installed upstream version does not match npm latest resolution');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh;
  if (typeof bin !== 'string') throw new Error('Upstream package does not declare a public dsh executable');
  const cli = await realpath(resolve(packageDirectory, bin));
  if (relative(await realpath(packageDirectory), cli).startsWith('..')) throw new Error('Upstream executable escapes its package');
  await mkdir(home, { recursive: true, mode: 0o700 });
  await run(process.execPath, [cli, '--profile', profile, '--from-default-profile', 'web', '--dump-config'], { ...context, cwd: directory, quiet: true });
  const require = createRequire(join(packageDirectory, 'package.json'));
  const webManifest = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-web-app/package.json'), 'utf8'));
  const additions = [...nativeAdditions, '@deepseek-ai/cordis'].map((name) => {
    const range = (name === '@deepseek-ai/cordis' ? manifest : webManifest).dependencies?.[name];
    if (typeof range !== 'string' || !range.length || /^(latest|next)$/.test(range)) throw new Error(`Official web profile does not declare a version range for ${name}`);
    return `${name}@${range}`;
  });
  await run(process.execPath, [cli, 'plugin', '--profile', profile, 'add', ...additions, pluginTarball], { ...context, cwd: directory });
  const result = {
    cli, node: process.execPath, home, profile, upstreamVersion, resolvedAt, installation: directory,
    locks: {
      installation: await lockMetadata(join(directory, 'package-lock.json')),
      profile: await lockMetadata(join(profileDirectory, 'pnpm-lock.yaml')),
    },
  };
  await writeFile(join(directory, 'installation.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await installUpstream({ ...parseInstallerArgs(process.argv.slice(2)), onLog: (message) => process.stderr.write(message) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
