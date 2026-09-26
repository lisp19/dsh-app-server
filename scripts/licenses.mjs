import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replaceAll('\r\n', '\n');
const lock = JSON.parse(read('package-lock.json'));
const sources = JSON.parse(read('licenses/desktop-runtime-sources.json'));
const buildSources = JSON.parse(read('licenses/build-distributed-sources.json'));
const inno = JSON.parse(read('licenses/inno-setup.json'));
const appimageNotices = read('licenses/appimage-runtime-notices.txt').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
const check = process.argv.includes('--check');
const entries = lock.packages;
for (const component of buildSources.components) {
  for (const [key, integrity] of Object.entries(component.lockPackages)) {
    if (entries[key]?.version !== component.version || entries[key]?.integrity !== integrity) {
      throw new Error(`Review redistributed build template notices for ${key}`);
    }
  }
}
const roles = new Map();
const nameOf = (key, entry) => entry.name ?? key.split('node_modules/').at(-1);

function resolveDependency(from, name) {
  let directory = from;
  while (true) {
    const key = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`;
    if (entries[key]) return entries[key].link ? entries[key].resolved : key;
    if (!directory) return undefined;
    directory = path.posix.dirname(directory);
    if (directory === '.') directory = '';
  }
}

function visit(key, role) {
  const assigned = roles.get(key) ?? new Set();
  if (assigned.has(role)) return;
  assigned.add(role);
  roles.set(key, assigned);
  const entry = entries[key];
  for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
    const resolved = resolveDependency(key, name);
    if (resolved) visit(resolved, role);
    else if (!entry.optionalDependencies?.[name] && !entry.peerDependenciesMeta?.[name]?.optional) {
      throw new Error(`Unresolved ${role} dependency: ${key} -> ${name}`);
    }
  }
}

visit('apps/electron', 'desktop-runtime');
visit('packages/server', 'server-runtime-and-peers');
for (const workspace of ['', 'apps/electron', 'packages/server']) {
  for (const name of Object.keys(entries[workspace].devDependencies ?? {})) {
    const resolved = resolveDependency(workspace, name);
    if (!resolved) throw new Error(`Unresolved development dependency: ${name}`);
    visit(resolved, 'development');
  }
}

const reviewed = new Map(sources.packages.map((entry) => [`${entry.name}@${entry.version}`, entry]));
const packages = Object.entries(entries)
  .filter(([key, entry]) => key.includes('node_modules/') && !entry.link)
  .map(([key, entry]) => {
    const name = nameOf(key, entry);
    const recorded = reviewed.get(`${name}@${entry.version}`);
    const license = entry.license ?? recorded?.license;
    if (!license) throw new Error(`Missing reviewed license metadata: ${name}@${entry.version}`);
    const scopes = [...(roles.get(key) ?? [])].sort();
    if (scopes.length === 0) throw new Error(`Dependency has no classified scope: ${key}`);
    if (scopes.includes('desktop-runtime') && (!recorded || recorded.integrity !== entry.integrity)) {
      throw new Error(`Review and refresh desktop license sources for ${name}@${entry.version}`);
    }
    return {
      path: key, name, version: entry.version, license, scopes,
      optional: entry.optional === true, integrity: entry.integrity ?? null,
      source: entry.resolved ?? null,
    };
  })
  .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const desktop = packages.filter((entry) => entry.scopes.includes('desktop-runtime'));
const mplPackages = packages.filter((entry) => entry.license === 'MPL-2.0');
const desktopNames = new Set(desktop.map((entry) => `${entry.name}@${entry.version}`));
for (const key of reviewed.keys()) {
  if (!desktopNames.has(key)) throw new Error(`Remove obsolete desktop license source: ${key}`);
}

const harnessLicense = read('licenses/DeepSeek-Harness-LICENSE.txt').trimEnd();
const desktopNotice = [
  'DSH Remote — third-party notices',
  '',
  'The application is MIT licensed. Dependencies retain their own licenses.',
  'This file includes every locked desktop runtime dependency, including optional',
  'native dependencies that may be absent on a particular platform.',
  '',
  'Electron and Chromium: installed applications include Electron-LICENSE.txt and',
  'LICENSES.chromium.html in resources/licenses (Contents/Resources/licenses on',
  'macOS), copied from the native Electron distribution. Retain',
  'these files and any additional original runtime notices. They cover the browser,',
  'Node.js, and their native third-party components and must not be replaced by',
  'this npm inventory. The remote Harness server is installed separately.',
  '',
  'DeepSeek Harness attribution (native integration and historical attribution):',
  'https://github.com/deepseek-ai/deepseek-harness',
  harnessLicense,
  ...sources.packages.slice().sort((a, b) => a.name < b.name ? -1 : 1).flatMap((entry) => [
    '', '='.repeat(72), `${entry.name}@${entry.version} — ${entry.license}`,
    entry.repository,
    ...entry.files.flatMap((file) => ['', `--- ${file.path} ---`, file.text.replaceAll('\r\n', '\n').trimEnd()]),
  ]),
  '', 'Build-distributed templates (separate from the npm runtime dependencies):',
  ...buildSources.components.flatMap((entry) => [
    '', '='.repeat(72), `${entry.name}@${entry.version} — ${entry.license}`,
    entry.repository,
    ...entry.files.flatMap((file) => ['', `--- ${file.path} ---`, file.text.trimEnd()]),
  ]),
  '', '='.repeat(72), `Windows installer: Inno Setup ${inno.version}`,
  inno.homepage, inno.source,
  'The Windows installer is made using Inno Setup and RemObjects Pascal Script.',
  'RemObjects Pascal Script: https://www.remobjects.com/ps.aspx',
  'LZMA2 decompression: Igor Pavlov, public domain.',
  'The original installer copyright and website notices are retained.',
  ...inno.files.flatMap((file) => ['', `--- ${file.path} ---`, file.text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()]),
  '', '='.repeat(72), appimageNotices,
  '',
].join('\n');

const summary = `<!-- Generated by node scripts/licenses.mjs. Do not edit. -->
# Third-party notices

DSH App Server and DSH Remote are distributed under [MIT](LICENSE). Third-party
software retains its own copyrights and license terms; this project's MIT license
does not relicense its dependencies.

## DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the
native GUI, runtime and plugin interfaces. It is installed separately from the
selected npm channel (\`latest\` or \`next\`) using its official CLI; upstream package
files are unmodified and are not bundled in the desktop application.
The original copyright is **Copyright (c) 2026 DeepSeek**. The complete permission
notice and disclaimer are preserved in [licenses/DeepSeek-Harness-LICENSE.txt](licenses/DeepSeek-Harness-LICENSE.txt).
Harness's republished Cordis foundation packages also retain their individual
upstream licenses (including Shigma's copyright); preserve those installed files.

## Locked dependency inventory

[licenses/npm-inventory.json](licenses/npm-inventory.json) records all ${packages.length}
locked third-party npm package entries, including exact versions, declared license
expressions, registry archive integrity, optional status, and dependency scopes.
Scopes can overlap. This inventory is metadata, not a substitute for license texts.
It includes all locked operating-system variants without requiring them to be installed.
The independently resolved native DSH installation and profile are outside this
root lockfile inventory; review their actual dependency trees separately.

| Scope | Entries | Distribution |
| --- | ---: | --- |
| Desktop runtime | ${desktop.length} | Bundled with Electron; exact npm notice texts are shipped with the application. |
| Server runtime and peers | ${packages.filter((p) => p.scopes.includes('server-runtime-and-peers')).length} | Installed separately by npm on the server; not included in the desktop app. |
| Development | ${packages.filter((p) => p.scopes.includes('development')).length} | Build and test tools; membership does not exclude a separate runtime role. |

## Desktop distribution

[apps/electron/THIRD_PARTY_NOTICES.txt](apps/electron/THIRD_PARTY_NOTICES.txt) contains
the complete locked npm runtime license texts and copyright notices. Its reviewed
inputs are [licenses/desktop-runtime-sources.json](licenses/desktop-runtime-sources.json).
These include ssh2, asn1, safer-buffer, bcrypt-pbkdf, tweetnacl, and the optional
cpu-features/buildcheck/nan chain. cpu-features bundles Google CPU Features under
Apache-2.0 and Android BSD terms, in addition to the wrapper's MIT license.
bcrypt-pbkdf retains the Niels Provos, Ted Unangst, and Joyent notices.

Generated package scripts and desktop/AppArmor templates also incorporate
electron-builder/app-builder-lib material under MIT. Its preserved copyright and
license appear in the desktop notice file, with reviewed inputs in
[licenses/build-distributed-sources.json](licenses/build-distributed-sources.json).
These templates are separate from the eight npm runtime packages.

The Windows installer uses Inno Setup ${inno.version}; its compiler download hash
and preserved license texts are recorded in [licenses/inno-setup.json](licenses/inno-setup.json).
Inno Setup permits use and redistribution under its published conditions; its
original installer copyright and website notices are retained. The notice file
also credits RemObjects Pascal Script and Igor Pavlov's public-domain LZMA decoder.
The Windows application directory is built without NSIS helpers.

The Linux AppImage includes an AppImageKit launcher, libappimage, squashfuse,
and XZ liblzma. Full runtime notices, including the GPL-2.0 notice in libappimage's
\`light_elf.h\`, are preserved in
[licenses/appimage-runtime-notices.txt](licenses/appimage-runtime-notices.txt)
and appended to the desktop notice file. This GPL-covered component is an
exception to the launcher's predominantly MIT licensing; it does not change
the license of the separate application payload. The release publishes the four
matching source archives alongside the AppImage, with pinned versions and hashes
in [licenses/appimage-runtime-sources.json](licenses/appimage-runtime-sources.json).
The six legacy desktop libraries in the packaging toolset are excluded from the
AppImage. Host-provided libraries are not part of that launcher distribution.

Electron is listed as a build dependency but its runtime is redistributed.
The native build copies Electron's \`LICENSE\` as \`Electron-LICENSE.txt\` and
\`LICENSES.chromium.html\` into the application's \`resources/licenses/\` directory
(\`Contents/Resources/licenses/\` on macOS). Preserve these and any original runtime
notices from the actual target Electron distribution in every final package. They cover
additional browser, Node.js, and native components outside the npm inventory.
The upstream [Electron license](https://github.com/electron/electron/blob/main/LICENSE)
is MIT; this does not make every bundled third-party component MIT.

## Server dependencies and other terms

Native DSH and its profile dependencies are installed dynamically on the server,
not bundled in the desktop application or the server plugin's npm tarball.
Each installation records its resolved version and installation/profile lockfile
hashes in \`installation.json\`. This root inventory is not a license audit of that
separate installation and makes no fixed claim about its MPL or other components.

Before redistributing a complete server installation, inspect the exact resolved
packages, preserve their LICENSE, NOTICE and third-party notices, and provide any
corresponding source required by their actual terms. For example, if that tree
includes LibreOffice Kit or platform engines under MPL, review their exact source
and redistribution materials; see the
[LibreOffice Kit source repository](https://github.com/deepseek-harness/libreoffice-kit).
The same separate review applies to build tools if their binaries are redistributed.
The locked desktop dependencies and the Electron/AppImage runtime still retain all
of their own third-party terms; removing DSH from this lockfile does not make the
desktop free of third-party runtime dependencies or relicense it entirely as MIT.

## Regeneration and release checks

Run \`node scripts/licenses.mjs\` to regenerate the inventory and notices, and
\`node scripts/licenses.mjs --check\` to detect stale outputs without writing.
The checker works without node_modules. When a desktop dependency changes, it
requires review of that exact npm archive (including vendored native sources),
updated texts and integrity in \`licenses/desktop-runtime-sources.json\`, then
regeneration. Check the built artifacts separately to confirm that the application
notice and Electron/Chromium license files survived packaging.
`;

const outputs = new Map([
  ['licenses/npm-inventory.json', JSON.stringify({
    description: 'Generated from package-lock.json. Scopes are dependency graph reachability, not a claim that all packages are redistributed. License expressions are declared metadata except reviewed legacy desktop metadata.',
    lockfileVersion: lock.lockfileVersion, packages,
  }, null, 2) + '\n'],
  ['THIRD_PARTY_NOTICES.md', summary],
  ['apps/electron/THIRD_PARTY_NOTICES.txt', desktopNotice],
]);
for (const [name, text] of outputs) {
  if (check) {
    if (!fs.existsSync(path.join(root, name)) || read(name) !== text) {
      throw new Error(`Stale ${name}; run node scripts/licenses.mjs`);
    }
  } else {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
}
console.log(`${check ? 'Verified' : 'Generated'} notices for ${packages.length} locked npm entries and ${desktop.length} desktop runtime entries.`);
