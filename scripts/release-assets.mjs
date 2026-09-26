/** Fail closed on incomplete release sets and emit portable SHA-256 metadata. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [directory, tag] = process.argv.slice(2);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!directory || tag !== `v${version}`) throw new Error('Usage: release-assets.mjs DIRECTORY v<current package version>');
for (const manifest of ['../apps/electron/package.json', '../packages/server/package.json']) {
  if (JSON.parse(await readFile(new URL(manifest, import.meta.url), 'utf8')).version !== version) {
    throw new Error('Workspace package versions do not agree');
  }
}
const names = [
  `dsh-app-server-server-${version}.tgz`,
  ...['win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb', 'mac-x64.dmg', 'mac-x64.zip', 'mac-arm64.dmg', 'mac-arm64.zip']
    .map(suffix => `dsh-remote-${version}-${suffix}`),
].sort();
const assets = [];
for (const [source, name] of [
  ['../LICENSE', 'LICENSE.txt'],
  ['../apps/electron/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
  ['../licenses/npm-inventory.json', 'npm-inventory.json'],
]) {
  await writeFile(join(directory, name), await readFile(new URL(source, import.meta.url)));
  names.push(name);
}
names.sort();
for (const name of names) {
  const bytes = await readFile(join(directory, name));
  if (!bytes.length) throw new Error(`Empty release artifact: ${name}`);
  assets.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(directory, 'SHA256SUMS'), assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
await writeFile(join(directory, 'release-manifest.json'), JSON.stringify({ version, assets }, null, 2) + '\n');
console.log(`Verified ${assets.length} required artifacts for ${tag}.`);
