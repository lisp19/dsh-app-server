import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const client = JSON.parse(await readFile(new URL('../apps/electron/package.json', import.meta.url)));
const server = JSON.parse(await readFile(new URL('../packages/server/package.json', import.meta.url)));
const script = new URL('../scripts/release-assets.mjs', import.meta.url);

test('all package versions agree and desktop targets cover each platform', () => {
  assert.match(root.version, /^\d+\.\d+\.\d+$/);
  assert.equal(client.version, root.version);
  assert.equal(server.version, root.version);
  assert.deepEqual(client.build.linux.target, ['AppImage', 'deb']);
  assert.deepEqual(client.build.mac.target, ['dmg', 'zip']);
  assert.match(client.build.artifactName, /\$\{os\}.*\$\{arch\}/);
});

test('release manifest requires every target, correct tag and nonempty artifacts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = tag => spawnSync(process.execPath, [fileURLToPath(script), directory, tag], { encoding: 'utf8' });
  assert.notEqual(run('v9.0.0').status, 0);
  assert.notEqual(run(`v${root.version}`).status, 0);
  const names = [
    `dsh-app-server-server-${root.version}.tgz`,
    ...['win-x64.exe', 'linux-x64.AppImage', 'linux-x64.deb', 'mac-x64.dmg', 'mac-x64.zip', 'mac-arm64.dmg', 'mac-arm64.zip']
      .map(suffix => `dsh-remote-${root.version}-${suffix}`),
  ];
  for (const name of names) await writeFile(join(directory, name), 'fixture');
  assert.notEqual(run(`v${root.version}`).status, 0, 'Corresponding AppImage sources are mandatory');
  const sources = JSON.parse(await readFile(new URL('../licenses/appimage-runtime-sources.json', import.meta.url)));
  const sourceNames = sources.components.flatMap(component => component.assets.map(asset => asset.name));
  for (const name of sourceNames) await writeFile(join(directory, name), 'source fixture');
  names.push(...sourceNames);
  const result = run(`v${root.version}`);
  assert.equal(result.status, 0, result.stderr);
  names.push('LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'npm-inventory.json', 'appimage-runtime-sources.json');
  const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  assert.equal(sums.trim().split('\n').length, names.length);
  assert.ok(names.every(name => sums.includes(`  ${name}\n`)));
  const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json')));
  assert.equal(manifest.version, root.version);
  assert.equal(manifest.assets.length, names.length);
  assert.ok(manifest.assets.every(asset => asset.bytes > 0 && /^[a-f0-9]{64}$/.test(asset.sha256)));
  await writeFile(join(directory, names[0]), '');
  assert.notEqual(run(`v${root.version}`).status, 0);
});
