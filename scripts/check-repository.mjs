/** Portable source hygiene, metadata and local documentation-link release gate. */
import { readFile, stat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const errors = [];
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const folder of ['', 'apps/electron', 'packages/server']) {
  const current = JSON.parse(await readFile(resolve(root, folder, 'package.json'), 'utf8'));
  if (current.version !== manifest.version || lock.packages[folder]?.version !== manifest.version) errors.push(`${folder || '.'}: version mismatch`);
  if (current.license !== 'MIT') errors.push(`${folder || '.'}: own-code license must be MIT`);
  if (await readFile(resolve(root, folder, 'LICENSE'), 'utf8') !== await readFile(resolve(root, 'LICENSE'), 'utf8')) errors.push(`${folder}: MIT license differs`);
}
if (lock.version !== manifest.version) errors.push('lockfile root version mismatch');
for (const name of tracked) {
  const filename = resolve(root, name);
  let info;
  try { info = await stat(filename); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!info.isFile()) continue;
  if (/(^|\/)(?:\.acceptance|\.integration|node_modules|\.env(?:\..*)?|login-password|connection\.json|ssh-hosts\.json)(?:\/|$)/.test(name)
    && !name.endsWith('.env.example')) errors.push(`${name}: local or secret-bearing file must not be tracked`);
  if (/\.(?:pem|key|p12|pfx)$/.test(name)) errors.push(`${name}: private key/certificate container must not be tracked`);
  if (/\.(?:js|mjs|cjs)$/.test(name)) {
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    if (result.status !== 0) errors.push(`${name}: syntax check failed`);
  }
  const content = await readFile(filename, 'utf8');
  // Do not print matching values: findings may themselves be sensitive.
  if (/-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/.test(content)
    || /gh[oprs]_[A-Za-z0-9]{30,}/.test(content)
    || /AKIA[A-Z0-9]{16}/.test(content)) errors.push(`${name}: possible embedded secret`);
  if (name.endsWith('.md')) {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0]);
      if (!relative) continue;
      try { await stat(resolve(dirname(filename), relative)); }
      catch { errors.push(`${name}: missing local link ${relative}`); }
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Repository metadata, source syntax, sensitive-file policy and local links checked (${tracked.length} tracked paths).`);
