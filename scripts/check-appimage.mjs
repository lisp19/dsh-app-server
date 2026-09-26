/** Inspect and extract our AppImage without executing its runtime or launcher. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node scripts/check-appimage.mjs APPIMAGE EMPTY_EXTRACTION_DIRECTORY');
const directory = resolve(output);
await mkdir(directory, { recursive: true });
assert.deepEqual(await readdir(directory), [], 'Extraction directory must be empty');
const file = await open(resolve(input));
try {
  const bytes = Buffer.alloc(188392);
  const result = await file.read(bytes, 0, bytes.length, 0);
  assert.equal(result.bytesRead, bytes.length, 'Truncated AppImage runtime');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '24da8e0e149b7211cbfb00a545189a1101cb18d1f27d4cfc1895837d2c30bc30', 'Unaudited AppImage runtime');
} finally { await file.close(); }
execFileSync('7z', ['x', '-y', `-o${directory}`, resolve(input)], { stdio: 'inherit' });
let libraries = [];
try { libraries = await readdir(join(directory, 'usr/lib')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.deepEqual(libraries, [], 'AppImage must not bundle legacy desktop libraries');
for (const name of ['AppRun', 'dsh-remote.desktop']) {
  const text = await readFile(join(directory, name), 'utf8');
  assert.equal(/--(?:no-sandbox|disable-setuid-sandbox)/.test(text), false, `${name} disables sandboxing`);
  assert.equal(/^export (?:LD_LIBRARY_PATH|GSETTINGS_SCHEMA_DIR)=/m.test(text), false, `${name} overrides host library or schema lookup`);
}
assert.match(await readFile(join(directory, 'dsh-remote.desktop'), 'utf8'), /^Exec=AppRun %U$/m);
assert.ok((await stat(join(directory, 'dsh-remote'))).isFile());
const notices = await readFile(join(directory, 'resources/licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
const expected = await readFile(new URL('../licenses/appimage-runtime-notices.txt', import.meta.url), 'utf8');
assert.ok(notices.includes(expected.trim()), 'AppImage runtime notices missing from package');
console.log(`AppImage runtime, notices, host-library policy and sandbox launcher verified: ${directory}`);
