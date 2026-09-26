/** Release notices are taken from the installed Electron runtime: build natively. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [platform, ...args] = process.argv.slice(2);
const expected = { win: 'win32', linux: 'linux', mac: 'darwin' }[platform];
if (!expected || process.platform !== expected) throw new Error('Build on the target OS to preserve matching Electron runtime licenses; use the native GitHub Actions matrix.');
const architectures = args.filter(value => /^--(?:x64|arm64|ia32|armv7l|universal)$/.test(value)).map(value => value.slice(2));
if (architectures.some(arch => arch !== process.arch)) throw new Error('Build on the target CPU architecture so bundled Electron notices match the runtime.');
const targets = { win: ['dir'], linux: ['AppImage', 'deb', 'dir'], mac: ['dmg', 'zip', 'dir'] }[platform];
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--publish' && args[index + 1] === 'never') { index++; continue; }
  if (targets.includes(argument) || argument === `--${process.arch}`) continue;
  throw new Error(`Unsupported native build option: ${argument}`);
}
if (platform === 'linux' && args.includes('AppImage')) await import('./prepare-appimage.mjs');
const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), `--${platform}`, ...args], { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
