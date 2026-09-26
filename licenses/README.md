# License inventory and preserved notices

The project's own code is [MIT licensed](../LICENSE). Dependencies keep their
original terms. [Third-party notices](../THIRD_PARTY_NOTICES.md) explain the
distribution scopes and attribution to DeepSeek Harness.

- `DeepSeek-Harness-LICENSE.txt` preserves the upstream MIT copyright and license.
- `npm-inventory.json` is generated from every locked npm package entry. Its
  desktop, server/peer, and development scopes can overlap; it is an inventory,
  not a replacement for the packages' license files.
- `desktop-runtime-sources.json` preserves reviewed, exact license texts from
  the eight locked desktop runtime packages, including optional native packages
  and their vendored source notices. Package version and archive integrity tie
  these snapshots to the lockfile. No installed packages are needed to check them.
- `build-distributed-sources.json` preserves the MIT copyright and license for
  electron-builder/app-builder-lib templates embedded in package scripts and
  desktop/AppArmor files. Tool versions and archive integrities are checked
  separately from the eight npm runtime packages.
- `inno-setup.json` pins the Windows installer compiler and its official download
  checksum, preserving Inno Setup and RemObjects Pascal Script notices. The build
  downloads this compiler into a temporary directory and verifies it before use.
- `appimage-runtime-sources.json` records the pinned AppImage runtime digest,
  component versions, source archive hashes and license evidence. The release
  includes four corresponding source archives for AppImageKit, libappimage,
  squashfuse and XZ. In particular, libappimage's `light_elf.h` carries
  GPL-2.0-only wording; removing legacy desktop libraries does not remove this
  runtime notice or relicense the runtime as MIT.
- `../apps/electron/THIRD_PARTY_NOTICES.txt` is the generated desktop notice file.
  Native packages also include the application's MIT license and Electron's
  original license and Chromium notices under their resources `licenses/` folder.

Regenerate and verify from the repository root:

```sh
node scripts/licenses.mjs
node scripts/licenses.mjs --check
```

When a desktop dependency changes, inspect the exact npm archive identified by
the new lockfile entry. Review its license, copyright, NOTICE, and nested vendored
source files, then update the corresponding snapshot's version, integrity,
repository, and complete notice texts. Add or remove entries when the runtime
dependency graph changes. Regenerate and review the diff; the checker rejects
unreviewed desktop versions or stale output.

Build on the target operating system and architecture so the copied Electron
notices match the runtime being shipped. After building, run
`node scripts/check-package.mjs PATH_TO_UNPACKED_APP` (pass the `.app` directory
on macOS). CI performs this check for every native platform build.

Run `node scripts/appimage-sources.mjs OUTPUT_DIRECTORY` to fetch and verify
the four pinned source archives. Release metadata requires all four and includes
them, together with `appimage-runtime-sources.json`, in `SHA256SUMS` and
`release-manifest.json`. Retain these materials when mirroring a release.

The server plugin's npm archive does not bundle native DSH. The root inventory does
not include the dynamically installed npm `latest`/`next` runtime or its profile tree.
Review the exact dependencies recorded by each installation and its
`installation.json` lockfile hashes separately. A complete server redistribution
must preserve the resolved packages' licenses and notices and satisfy their actual
source obligations, including MPL obligations if LibreOffice Kit or relevant
engines occur in that tree. Redistributing development tools also requires review.
Desktop packages still contain Electron and SSH/runtime dependencies with their
own notices; no DSH bundle does not mean no third-party runtime dependencies.
