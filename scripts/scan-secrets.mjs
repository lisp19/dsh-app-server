/** Pinned, checksum-verified Gitleaks scan of all reachable Git history. Linux x64. */
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Run the pinned secret scanner on Linux x64 or in GitHub Actions.');
const root = fileURLToPath(new URL('../', import.meta.url));
const version = '8.30.1';
const sha256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';
const directory = await mkdtemp(join(tmpdir(), 'dsh-secret-scan-'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Secret scan command failed (${result.status}); inspect redacted findings above.`);
}
try {
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Gitleaks download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Gitleaks checksum mismatch');
  const archive = join(directory, 'gitleaks.tar.gz');
  await writeFile(archive, bytes, { mode: 0o600 });
  run('tar', ['-xzf', archive, '-C', directory, 'gitleaks']);
  run(join(directory, 'gitleaks'), ['git', root, '--log-opts=--all', '--redact', '--no-banner']);
} finally {
  await rm(directory, { recursive: true, force: true });
}
