# License inventory and preserved notices

The project's own code is [MIT licensed](../LICENSE). Dependencies keep their
original terms. [Third-party notices](../THIRD_PARTY_NOTICES.md) explain the
distribution scopes and attribution to DeepSeek Harness.

- `DeepSeek-Harness-LICENSE.txt` preserves the upstream MIT notice for source
  excerpts in the compatibility patches.
- `npm-inventory.json` is generated from every locked npm package entry. Its
  desktop, server/peer, and development scopes can overlap; it is an inventory,
  not a replacement for the packages' license files.
- `desktop-runtime-sources.json` preserves reviewed, exact license texts from
  the eight locked desktop runtime packages, including optional native packages
  and their vendored source notices. Package version and archive integrity tie
  these snapshots to the lockfile. No installed packages are needed to check them.
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

The server plugin's npm archive does not bundle its dependencies. A complete
server redistribution needs an additional review of the separately installed
Harness packages, including LibreOffice Kit's MPL source and notice obligations.
Development-only LGPL tools are not part of the desktop runtime. These distinctions
do not remove obligations if those tools or full server installations are later
redistributed.
