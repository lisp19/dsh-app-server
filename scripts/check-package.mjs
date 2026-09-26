/** Check the unpacked directory used to produce native installers. */
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile } from '@electron/asar';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error('Usage: node scripts/check-package.mjs UNPACKED_APPLICATION_DIRECTORY');
const application = resolve(directory);
const resources = join(application, application.endsWith('.app') ? 'Contents/Resources' : 'resources');
for (const [name, source] of [
  ['DSH-App-Server-LICENSE.txt', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.txt', 'apps/electron/THIRD_PARTY_NOTICES.txt'],
  ['Electron-LICENSE.txt', 'node_modules/electron/dist/LICENSE'],
  ['LICENSES.chromium.html', 'node_modules/electron/dist/LICENSES.chromium.html'],
]) {
  const actual = await readFile(join(resources, 'licenses', name));
  const expected = await readFile(join(root, source));
  if (!actual.length || !actual.equals(expected)) throw new Error(`Missing or modified packaged notice: ${name}`);
}
const archive = join(resources, 'app.asar');
await stat(archive);
const files = listPackage(archive).map(name => name.replaceAll('\\', '/'));
if (files.some(name => /(?:^|\/)(?:\.acceptance|\.integration|\.env|login-password)(?:\/|$)/.test(name)
  || /node_modules\/@deepseek-ai\//.test(name))) throw new Error('Desktop contains local data or a bundled Harness runtime');
const inventory = JSON.parse(await readFile(join(root, 'licenses/npm-inventory.json'), 'utf8'));
const reviewed = new Set(inventory.packages.filter(entry => entry.scopes.includes('desktop-runtime')).map(entry => `${entry.name}@${entry.version}`));
for (const filename of files.filter(name => /\/node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(name))) {
  const manifest = JSON.parse(extractFile(archive, filename.replace(/^\//, '')).toString());
  if (!reviewed.has(`${manifest.name}@${manifest.version}`)) throw new Error(`Unreviewed bundled dependency: ${manifest.name}@${manifest.version}`);
}
console.log('Packaged MIT, npm, Electron and Chromium notices match their sources; no Harness runtime/local profile bundled.');
