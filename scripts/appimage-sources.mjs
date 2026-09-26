/** Fetch the exact corresponding sources shipped alongside our AppImage. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const [output] = process.argv.slice(2);
if (!output || process.argv.length !== 3) throw new Error('Usage: appimage-sources.mjs OUTPUT_DIRECTORY');
const directory = resolve(output);
const manifest = JSON.parse(await readFile(new URL('../licenses/appimage-runtime-sources.json', import.meta.url), 'utf8'));
await mkdir(directory, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const names = new Set();
for (const asset of manifest.components.flatMap(component => component.assets)) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tar\.gz$/.test(asset.name) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) || new URL(asset.url).protocol !== 'https:' || names.has(asset.name)) {
    throw new Error('Invalid or duplicate source archive specification');
  }
  names.add(asset.name);
  const destination = join(directory, asset.name);
  let bytes;
  try { bytes = await readFile(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw new Error(`Source download failed: ${asset.name} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== asset.sha256) throw new Error(`Source checksum mismatch: ${asset.name}`);
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  if (digest(bytes) !== asset.sha256) throw new Error(`Source checksum mismatch: ${asset.name}`);
  console.log(`Verified corresponding source: ${asset.name}`);
}
