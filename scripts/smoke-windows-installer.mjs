/** Install, exercise, and uninstall the actual release EXE on an isolated CI runner. */
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, access, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.env.CI !== 'true') {
  throw new Error('Installer smoke requires an isolated Windows CI runner (CI=true).');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const installer = path.join(root, `apps/electron/dist/dsh-remote-${version}-win-x64.exe`);
const fixture = path.join(root, 'artifacts/installer-fixture/dsh-remote-0.0.0-win-x64.exe');
const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-installer-smoke-'));
const destination = path.join(temporary, 'DSH Remote');
const reports = path.join(root, 'artifacts/screenshots');
await mkdir(reports, { recursive: true });
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}
let installed = false;
const registry = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\org.dsh.appserver.client_is1';
const registered = () => spawnSync('reg.exe', ['query', registry], { stdio: 'ignore' }).status === 0;
const installedVersion = () => execFileSync('reg.exe', ['query', registry, '/v', 'DisplayVersion'], { encoding: 'utf8' }).match(/DisplayVersion\s+REG_SZ\s+(\S+)/)?.[1];
assert.equal(registered(), false, 'Installer CI must start without an existing installation');
const folder = name => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetFolderPath('${name}')`], { encoding: 'utf8' }).trim();
const shortcuts = [path.join(folder('Programs'), 'DSH Remote', 'DSH Remote.lnk'), path.join(folder('Desktop'), 'DSH Remote.lnk')];
for (const shortcut of shortcuts) await assert.rejects(access(shortcut), { code: 'ENOENT' });
const userData = path.join(process.env.APPDATA, '@dsh-app-server', 'electron');
await mkdir(userData, { recursive: true });
const marker = path.join(userData, 'installer-preservation-fixture.txt');
await writeFile(marker, 'retain-user-data', { flag: 'wx' });
const installArguments = log => ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/TASKS=desktopicon', `/DIR=${destination}`, `/LOG=${path.join(reports, log)}`];
try {
  await run(fixture, installArguments('windows-install.log'));
  installed = true;
  assert.equal(registered(), true);
  assert.equal(installedVersion(), '0.0.0');
  for (const shortcut of shortcuts) await access(shortcut);
  await writeFile(path.join(destination, 'resources/licenses/DSH-App-Server-LICENSE.txt'), 'outdated fixture file');
  await run(installer, installArguments('windows-upgrade.log'));
  assert.equal(registered(), true);
  assert.equal(installedVersion(), version);
  assert.equal(await readFile(marker, 'utf8'), 'retain-user-data');
  const executable = path.join(destination, 'DSH Remote.exe');
  await access(executable);
  await run(process.execPath, ['scripts/check-package.mjs', destination]);
  await run(process.execPath, ['apps/electron/tests/smoke.mjs'], { ...process.env, DSH_ELECTRON_EXECUTABLE: executable });
} finally {
  if (installed) {
    await run(path.join(destination, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(reports, 'windows-uninstall.log')}`]);
    await assert.rejects(access(path.join(destination, 'DSH Remote.exe')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(destination, 'resources/app.asar')), { code: 'ENOENT' });
    assert.equal(registered(), false);
    for (const shortcut of shortcuts) await assert.rejects(access(shortcut), { code: 'ENOENT' });
    assert.equal(await readFile(marker, 'utf8'), 'retain-user-data');
  }
  await unlink(marker);
  await rm(temporary, { recursive: true, force: true });
}
console.log('Actual Windows installer passed install, upgrade/reinstall, application smoke, uninstall and user-data preservation checks.');
