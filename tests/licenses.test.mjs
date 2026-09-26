import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

test('license gate accepts Windows checkout line endings but rejects changed content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-license-crlf-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = [
    'scripts/licenses.mjs', 'package-lock.json', 'THIRD_PARTY_NOTICES.md',
    'apps/electron/THIRD_PARTY_NOTICES.txt', 'licenses/npm-inventory.json',
    'licenses/desktop-runtime-sources.json', 'licenses/build-distributed-sources.json',
    'licenses/inno-setup.json', 'licenses/appimage-runtime-notices.txt',
    'licenses/DeepSeek-Harness-LICENSE.txt',
  ];
  for (const name of names) {
    const filename = join(directory, name);
    await mkdir(dirname(filename), { recursive: true });
    const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    await writeFile(filename, source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  }
  const run = () => spawnSync(process.execPath, [join(directory, 'scripts/licenses.mjs'), '--check'], { encoding: 'utf8' });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), 'changed notice');
  assert.notEqual(run().status, 0);
});
