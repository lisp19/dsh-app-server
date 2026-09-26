/** Build on native Windows using the reviewed, checksum-pinned Inno compiler. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build the Windows installer on native Windows x64.');
}
for (const option of process.argv.slice(2)) {
  if (option !== '--x64') throw new Error(`Unsupported installer build option: ${option}`);
}
const pin = JSON.parse(await readFile(path.join(root, 'licenses/inno-setup.json'), 'utf8'));
const { version } = JSON.parse(await readFile(path.join(root, 'apps/electron/package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid application version');
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}

await run(process.execPath, ['scripts/licenses.mjs', '--check']);
await run(process.execPath, [path.join(root, 'scripts/native-build.mjs'), 'win', 'dir', '--x64', '--publish', 'never'], path.join(root, 'apps/electron'));
const unpacked = path.join(root, 'apps/electron/dist/win-unpacked');
await run(process.execPath, ['scripts/check-package.mjs', unpacked]);
try {
  await access(path.join(unpacked, 'resources/elevate.exe'));
  throw new Error('Unexpected NSIS elevation helper in directory build');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-inno-compiler-'));
try {
  const response = await fetch(pin.compiler.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Compiler download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== pin.compiler.sha256) {
    throw new Error('Inno Setup compiler archive checksum mismatch');
  }
  const archive = path.join(temporary, 'innosetup.exe');
  const compilerDirectory = path.join(temporary, 'compiler');
  await writeFile(archive, bytes);
  await run(archive, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CURRENTUSER', '/PORTABLE=1', '/NOICONS', '/TASKS=', `/DIR=${compilerDirectory}`]);
  if (process.env.CI === 'true') {
    const fixtureDirectory = path.join(root, 'artifacts/installer-fixture');
    await mkdir(fixtureDirectory, { recursive: true });
    await run(path.join(compilerDirectory, 'ISCC.exe'), [
      '/DAppVersion=0.0.0', `/DAppSource=${unpacked}`, `/DAppOutput=${fixtureDirectory}`,
      path.join(root, 'apps/electron/installer/windows.iss'),
    ]);
  }
  await run(path.join(compilerDirectory, 'ISCC.exe'), [
    `/DAppVersion=${version}`, `/DAppSource=${unpacked}`,
    `/DAppOutput=${path.join(root, 'apps/electron/dist')}`,
    path.join(root, 'apps/electron/installer/windows.iss'),
  ]);
  const artifact = path.join(root, `apps/electron/dist/dsh-remote-${version}-win-x64.exe`);
  if ((await stat(artifact)).size === 0) throw new Error('Empty Windows installer');
  console.log(`Built ${path.basename(artifact)} with Inno Setup ${pin.version}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
