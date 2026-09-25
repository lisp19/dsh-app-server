# Multi-platform Release Implementation Plan

> Execute with subagent-driven-development. The user authorized autonomous decisions and release publication. Original Harness repository remains read-only.

**Goal:** Prepare private `lisp19/dsh-app-server` releases with Electron desktop packages, a normally installed Linux server plugin, and reproducible Linux functional/experience acceptance evidence.

**Architecture:** Keep the existing isolated Electron/Host design. Use native GitHub Actions runners for Windows x64, Linux x64, and macOS x64/arm64 packaging. Keep semantic version tags immutable: publish the existing 0.1.0 baseline and a 0.2.0 multi-platform release. No signing credentials are available, so packages are explicitly unsigned/unnotarized.

**Tech stack:** Electron Builder, Playwright Electron automation, npm workspaces, normal Harness profiles/plugins, GitHub CLI and Actions.

## Task 1: Linux packaged application acceptance

Files: `scripts/electron-integration.mjs`, `scripts/experience.mjs`, `docs/qa-linux.md`.

- [x] Run the existing 13 tests and actual Harness integration again.
- [x] Allow `DSH_ELECTRON_EXECUTABLE` to select the packaged binary for both initial launch and reopening; omit source application argv in that mode.
- [x] Run full GUI flows against that binary: authentication, streaming, remote browsing, disconnect recovery, continuing tasks after exit, history restoration.
- [x] Check connection-page English/Chinese, invalid form feedback, keyboard focus, resize at supported minimum and desktop dimensions, and render screenshots. Inspect images, page errors and failed requests; report upstream GUI issues separately without editing the original repository.

## Task 2: Cross-platform packaging and release workflow

Files: root and Electron `package.json`, lockfile, `.github/workflows/verify.yml`, `.github/workflows/release.yml`, `scripts/release-assets.mjs`, `tests/release.test.mjs`.

- [x] Version manifests consistently at 0.2.0; remove hard-coded integration tarball version by reading the server manifest.
- [x] Build Windows NSIS x64; Linux AppImage/deb x64; macOS dmg/zip x64 and arm64. Artifact filenames include version, OS and architecture.
- [x] Use native runner jobs, `npm ci`, tests and smoke checks; publish only after all jobs succeed. Tag must equal manifest version. Release assets include plugin tarball and SHA-256 sums.
- [x] Verify actual workflow executions and downloaded assets, not just YAML presence.

## Task 3: Standard repository and release preparation

Files: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, release notes and acceptance instructions.

- [x] Retain MIT license, document contribution/testing/versioning/security reporting and deployment limitations.
- [x] Create `lisp19/dsh-app-server` private via `gh`, set `main` as default, push committed code without credentials or integration data.
- [x] Tag 0.1.0 at baseline commit `f406bb6`, attach existing verified baseline artifacts; tag 0.2.0 only at tested release source.
- [x] Install the final plugin tarball using `dsh plugin --profile app-server add` in a dedicated local acceptance profile. Provide repeatable launch instructions without publishing credentials.
- [x] Review spec compliance then code quality; verify release visibility, asset hashes, CI conclusions and original repository cleanliness.

## Acceptance evidence

Keep `docs/qa-linux.md` and release verification records factual. Native CI launch/build tests are not interactive Windows/macOS desktop acceptance. Never claim signed/notarized packages or real model-provider calls without corresponding evidence. Account/CI restrictions remain blockers rather than reasons to omit a platform.
