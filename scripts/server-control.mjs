#!/usr/bin/env node
/** Install and manage a user systemd service from an explicit machine-local JSON file. */
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChannelOption } from './install-upstream.mjs';

const [configArgument, action = 'status', ...extra] = process.argv.slice(2);
if (!configArgument || !['install', 'start', 'stop', 'restart', 'status', 'port', 'logs'].includes(action)) {
  console.error('Usage: node scripts/server-control.mjs /absolute/path/server.json install [--channel latest|next] | start|stop|restart|status|port|logs');
  process.exit(2);
}
if (action !== 'install' && extra.length) throw new Error('--channel is only supported for install');
parseChannelOption(extra);
if (process.platform !== 'linux') throw new Error('This command requires Linux and user systemd.');
const configPath = resolve(configArgument);
let config = JSON.parse(await readFile(configPath, 'utf8'));
for (const key of ['node', 'home', 'workspace', ...(action === 'install' ? [] : ['cli'])]) {
  if (typeof config[key] !== 'string' || !isAbsolute(config[key]) || /[\x00-\x1f\x7f]/.test(config[key])) {
    throw new Error(`${key} must be an absolute path without control characters.`);
  }
}
if (!/^[a-zA-Z0-9_-]+$/.test(config.profile ?? '')) throw new Error('Invalid profile name.');
if (!/^dsh-app-server(?:-[a-zA-Z0-9_-]+)?\.service$/.test(config.service ?? '')) throw new Error('Invalid DSH service name.');
if (!/^dsh-server(?:-[a-zA-Z0-9_-]+)?$/.test(config.commandName ?? 'dsh-server')) throw new Error('Invalid command name.');
if (!['127.0.0.1', '0.0.0.0'].includes(config.host)) throw new Error('host must be 127.0.0.1 or 0.0.0.0.');
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('port must be between 1 and 65535.');
if (config.passwordFile !== undefined && ['install', 'start', 'restart'].includes(action)) {
  if (typeof config.passwordFile !== 'string' || !isAbsolute(config.passwordFile) || /[\x00-\x1f\x7f]/.test(config.passwordFile)) throw new Error('passwordFile must be an absolute path.');
  const password = (await readFile(config.passwordFile, 'utf8')).trimEnd();
  if (password.length < 8 || password.length > 1024 || password !== password.trim() || /[\r\n\0]/.test(password)) throw new Error('Password must contain 8–1024 characters on one line without surrounding whitespace.');
  if (((await stat(config.passwordFile)).mode & 0o077) !== 0) throw new Error('Password file must not be accessible by group or other users; use chmod 600.');
}
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
// ExecStart also expands dollar signs; Environment values only expand specifiers.
const unitQuote = value => JSON.stringify(value.replaceAll('%', '%%'));
const execQuote = value => unitQuote(value.replaceAll('$', '$$'));
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

if (action === 'install') {
  for (const key of ['node', 'workspace']) await stat(config[key]);
  run(config.node, [fileURLToPath(new URL('./configure-profile.mjs', import.meta.url)), configPath, ...extra]);
  config = JSON.parse(await readFile(configPath, 'utf8'));
  const localDirectory = dirname(configPath);
  const unit = join(localDirectory, config.service);
  const unitDirectory = join(homedir(), '.config/systemd/user');
  const binDirectory = join(homedir(), '.local/bin');
  const launcher = join(binDirectory, config.commandName ?? 'dsh-server');
  await mkdir(unitDirectory, { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  const argumentsList = [config.node, fileURLToPath(new URL('./serve.mjs', import.meta.url)), configPath];
  const workingDirectory = config.workspace.replaceAll('%', '%%').replaceAll('\\', '\\x5c').replaceAll(' ', '\\x20');
  const passwordEnvironment = '';
  const contents = `[Unit]\nDescription=DSH App Server\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${workingDirectory}\nEnvironment=${unitQuote(`DSH_HOME=${config.home}`)}\n${passwordEnvironment}Environment=DSH_TELEMETRY_DISABLED=1\nEnvironment=${unitQuote(`PATH=${dirname(config.node)}:/usr/local/bin:/usr/bin:/bin`)}\nExecStart=${argumentsList.map(execQuote).join(' ')}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=90\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
  // Preserve the preceding generated unit before replacing an existing deployment.
  try { await copyFile(unit, `${unit}.previous`, constants.COPYFILE_EXCL); }
  catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  await writeFile(unit, contents, { mode: 0o600 });
  const installedUnit = join(unitDirectory, config.service);
  // Existing symlinks may already point at this generated unit.
  if (await readFile(installedUnit, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) !== contents) {
    try { await copyFile(installedUnit, `${installedUnit}.previous`, constants.COPYFILE_EXCL); }
    catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
    await writeFile(installedUnit, contents, { mode: 0o600 });
  }
  const script = fileURLToPath(import.meta.url);
  await writeFile(launcher, `#!/bin/sh\nexec ${shellQuote(config.node)} ${shellQuote(script)} ${shellQuote(configPath)} "$@"\n`, { mode: 0o755 });
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', config.service]);
  run('systemctl', ['--user', 'restart', config.service]);
  console.log(`Installed ${config.service}. Command: ${launcher}`);
  console.log('For boot without login, ensure: loginctl enable-linger USER');
} else if (action === 'port') {
  console.log(`Configured listener: ${config.host}:${config.port}`);
  run('ss', ['-ltnp', `sport = :${config.port}`]);
} else if (action === 'logs') {
  run('journalctl', ['--user', '-u', config.service, '-n', '100', '--no-pager']);
} else {
  run('systemctl', ['--user', action, config.service, ...(action === 'status' ? ['--no-pager', '--full'] : [])]);
}
