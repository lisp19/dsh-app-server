# Contributing

Use Node.js 24 and install the locked dependencies with `npm ci`. See [development](docs/development.md) for tests and packaging, and [architecture](docs/architecture.md) for component boundaries.

Open a focused pull request with the problem, resulting behavior and validation performed. Include a regression test for behavior changes where practical. Keep local deployments, credentials, logs and generated artifacts out of commits. Integrate through public upstream CLI/plugin capabilities and this project's gateway and transport boundaries. Do not patch upstream package files, read private authentication state, or copy the native GUI into desktop packages. Preserve upstream attribution.

## Validation

Run `npm test` for code changes. Authentication, transport, lifecycle and GUI changes also require the Electron smoke test and Harness integration checks in the development guide. Use deterministic model fixtures; paid provider calls are not required. `npm run prepare:integration -- --channel next` selects `next`; omitting the option selects `latest`.

## Releases

1. Update root, client and plugin versions together, refresh `package-lock.json`, and update the changelog and versioned release notes. Keep DSH outside the root dependency tree. Record the tested upstream channel, version and lockfile hashes.
2. Run the tests and native platform builds, including Windows installer lifecycle checks. Review package contents and third-party notices; see [packaging](docs/packaging.md).
3. Tag the reviewed commit with an annotated `v<VERSION>` tag. The release pipeline must pass its test and artifact gates before publishing.
4. Verify the published asset list, manifest and `SHA256SUMS`. Published versions are immutable; corrections require a new version.

Publisher signing and Apple notarization require separately provisioned credentials. CI reports distinguish deterministic integration tests from live-provider authentication and manual installation checks.

Keep the Windows installer identity stable. The v0.x NSIS-to-Inno transition requires uninstalling the old installation first. AppImage tooling changes must retain version/content guards, Electron sandboxing and final-artifact checks.

By contributing, you agree that your original contributions are provided under the project's MIT license. Keep copyright and license notices for third-party material intact.
