# Contributing

Use Node.js 24 and install the locked dependencies with `npm ci`. See [development](docs/development.md) for tests and packaging, and [architecture](docs/architecture.md) for component boundaries.

Open a focused pull request with the problem, resulting behavior and validation performed. Include a regression test for behavior changes where practical. Keep local deployments, credentials, logs and generated artifacts out of commits. Integrate through public upstream CLI/plugin capabilities and this project's gateway and transport boundaries. Do not patch upstream package files, read private authentication state, or copy the native GUI into desktop packages. Preserve upstream attribution.

## Validation

Run `npm test` for every code change. Authentication, transport, lifecycle and GUI changes also require the Electron smoke test and actual Harness integration checks documented in the development guide. Test with deterministic model fixtures; paid provider calls are not required. Platform packaging checks do not substitute for functional tests or interactive installer testing.

## Releases

1. Update root, client and plugin versions together, refresh `package-lock.json`, and update the changelog and versioned release notes. Keep DSH outside the root dependency tree; resolve npm `latest` in a fresh installation and retain its version, resolution date and lockfile evidence with functional validation results.
2. Run the required tests and native platform builds on the candidate commit. Windows must exercise the actual Inno Setup installer through silent installation, upgrade/reinstallation, installed-app launch and uninstallation, including preservation of user data. Review final package contents and third-party license notices; see [packaging](docs/packaging.md).
3. Tag the reviewed commit with an annotated `v<VERSION>` tag. The release pipeline must pass its test and artifact gates before publishing.
4. Verify the published asset list, manifest and `SHA256SUMS`. Published versions are immutable; corrections require a new version.

Report what actually ran and distinguish automated checks from manual installation or live-provider verification. Never label a build-only result as a functional test pass. Publisher signing and Apple notarization require separately provisioned credentials.

Keep the Windows installer identity stable across releases. The v0.x NSIS-to-Inno transition requires users to uninstall the old installation first; do not describe it as an automatic migration. Changes to AppImage tooling must retain its version/content guards, Electron sandboxing and final-artifact checks. A license inventory alone does not establish the contents or license obligations of a produced installer.

By contributing, you agree that your original contributions are provided under the project's MIT license. Keep copyright and license notices for third-party material intact.
