/** Compare the prepared native installation with integrity-verified official npm archives. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(join(root, '.integration/latest-installation.json'), 'utf8'));
const profile = join(metadata.home, 'profiles', metadata.profile);
const profileManifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
if (Object.keys(profileManifest.pnpm?.patchedDependencies ?? {}).length) throw new Error('Prepared profile contains patchedDependencies');

const locks = {};
for (const [name, location] of [
  ['installation', join(metadata.installation, 'package-lock.json')],
  ['profile', join(profile, 'pnpm-lock.yaml')],
]) {
  const bytes = await readFile(location);
  if (name === 'profile' && /^patchedDependencies\s*:/m.test(bytes.toString())) throw new Error('Prepared profile lockfile contains patchedDependencies');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== metadata.locks?.[name]?.sha256) throw new Error(`${name} lockfile differs from installation metadata`);
  locks[name] = { sha256, matchesInstallationMetadata: true };
}

async function fetchRegistry(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.port) {
    throw new Error('Integrity verification only permits the official HTTPS npm registry');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`npm registry request failed: HTTP ${response.status}`);
  return response;
}

async function verifyPackage(shortName) {
  const name = `@deepseek-ai/${shortName}`;
  const directory = join(metadata.installation, 'node_modules', name);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== name || typeof manifest.version !== 'string') throw new Error(`Invalid installed manifest: ${name}`);
  const published = await (await fetchRegistry(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(manifest.version)}`)).json();
  if (published.name !== name || published.version !== manifest.version) throw new Error(`Unexpected registry identity: ${name}`);
  const archive = Buffer.from(await (await fetchRegistry(published.dist.tarball)).arrayBuffer());
  const integrity = published.dist.integrity;
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match || createHash('sha512').update(archive).digest('base64') !== match[1]) throw new Error(`Published archive integrity mismatch: ${name}`);
  const tar = gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 });
  let checkedFiles = 0;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString().split('\0')[0];
    const prefix = field(345, 500);
    const filename = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`;
    const size = parseInt(field(124, 136).trim(), 8) || 0;
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error(`Invalid archive size: ${name}`);
    const type = header[156];
    if (type === 48 || type === 0) {
      if (!filename.startsWith('package/') || filename.split('/').includes('..') || filename.includes('\\')) throw new Error(`Invalid archive path: ${name}`);
      const installed = await readFile(join(directory, filename.slice(8)));
      if (!installed.equals(tar.subarray(offset + 512, offset + 512 + size))) throw new Error(`Installed file differs from npm: ${name}/${filename.slice(8)}`);
      checkedFiles++;
    } else if (type !== 53) {
      // Fail closed if a future release requires additional tar entry formats.
      throw new Error(`Unsupported archive entry type ${type}: ${name}`);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!checkedFiles) throw new Error(`Archive contained no verified files: ${name}`);
  return { name, version: manifest.version, integrity, checkedFiles, installedBytesMatchPublished: true };
}

const packages = [];
for (const name of ['dsh', 'dsh-client-connection', 'dsh-client-ui-settings', 'dsh-host-webserver', 'dsh-host-frontend-static', 'dsh-web-app']) {
  const result = await verifyPackage(name);
  packages.push(result);
  console.log(`Verified ${result.name}@${result.version}: ${result.checkedFiles} files match official npm bytes`);
}
const report = { verifiedAt: new Date().toISOString(), profileHasNoPatchedDependencies: true, locks, packages };
const reportPath = join(root, 'artifacts/screenshots/upstream-integrity.json');
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Saved sanitized report: artifacts/screenshots/upstream-integrity.json');
