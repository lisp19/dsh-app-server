/** Narrow, fail-closed adaptation of electron-builder's pinned AppImage writer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const directory = dirname(require.resolve('app-builder-lib/package.json'));
const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
assert.equal(manifest.version, '26.15.3', 'Review the AppImage adapter before upgrading electron-builder');
const digest = data => createHash('sha256').update(data).digest('hex');
const { patches } = JSON.parse(await readFile(new URL('../licenses/appimage-adapter-hashes.json', import.meta.url), 'utf8'));
const specifications = [
  {
    file: 'out/targets/appimage/appImageUtil.js',
    original: '4d3b63afc9939ace718e0b3537e2b1508c15fde7fd030206cbe207bcb6a8f030',
    transform: source => source
      .replace(/        \/\/ Mirror the app-builder-lib Go implementation:[\s\S]*?\n        await \(0, builder_util_1\.copyDir\)\(appDir, stageDir\);/, '        // DSH: use host desktop libraries; do not bundle obsolete GPL/LGPL libraries.\n        await (0, builder_util_1.copyDir)(appDir, stageDir);')
      .replace(/HAVE_NO_SANDBOX=0[\s\S]*?\nfi\n\natexit\(\)/, '# DSH: preserve Chromium sandboxing; unsupported hosts must fail closed.\natexit()')
      .replace(/^export (?:LD_LIBRARY_PATH|GSETTINGS_SCHEMA_DIR)=.*\n/gm, '')
      .replaceAll(' "\\${NO_SANDBOX[@]}"', ''),
  },
  {
    file: 'out/targets/appimage/AppImageTarget.js',
    original: 'e681ec08f713e76e84c8001a2e3ba8cb8c5d67ea72fe2a66b6eb32be79446fea',
    transform: source => source.replace('const defaultArgs = appimageTool == null || appimageTool === "0.0.0" ? ["--no-sandbox"] : [];', 'const defaultArgs = []; // DSH: never disable the Chromium sandbox.'),
  },
];

// Original snapshots live in npm's integrity-checked package. Accept only those
// exact bytes or our exact derived result, so reruns are safe and drift is fatal.
const changes = [];
for (const spec of specifications) {
  const filename = join(directory, spec.file);
  const current = await readFile(filename, 'utf8');
  if (digest(current) === spec.original) {
    const patched = spec.transform(current);
    assert.equal(digest(patched), patches[spec.file], `Adapter output changed for ${spec.file}; review the patch`);
    changes.push({ filename, patched });
  } else {
    assert.equal(digest(current), patches[spec.file], `Unexpected toolchain bytes in ${spec.file}; reinstall with npm ci and review the adapter`);
  }
}
for (const { filename, patched } of changes) await writeFile(filename, patched);
console.log('Pinned AppImage writer prepared: host desktop libraries; sandbox retained.');
