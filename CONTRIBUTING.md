# Contributing

Use Node.js 24 and install the locked dependencies with `npm ci`. See [development](docs/development.md) for tests and packaging, and [architecture](docs/architecture.md) for component boundaries.

Open a focused pull request with the problem, resulting behavior and validation performed. Include a regression test for behavior changes where practical. Keep local deployments, credentials, logs and generated artifacts out of commits. Upstream Harness changes belong upstream; version-specific integration patches belong in `compat/` and must preserve upstream attribution.

## Validation

Run `npm test` for every code change. Authentication, transport, lifecycle and GUI changes also require the Electron smoke test and actual Harness integration checks documented in the development guide. Test with deterministic model fixtures; paid provider calls are not required. Platform packaging checks do not substitute for functional tests or interactive installer testing.

## Releases

1. Update root, client and plugin versions together, refresh `package-lock.json`, and update the changelog and versioned release notes.
2. Run the required tests and native platform builds on the candidate commit. Review package contents and third-party license notices.
3. Tag the reviewed commit with an annotated `v<VERSION>` tag. The release pipeline must pass its test and artifact gates before publishing.
4. Verify the published asset list, manifest and `SHA256SUMS`. Published versions are immutable; corrections require a new version.

Report what actually ran and distinguish automated checks from manual installation or live-provider verification. Never label a build-only result as a functional test pass. Publisher signing and Apple notarization require separately provisioned credentials.

By contributing, you agree that your original contributions are provided under the project's MIT license. Keep copyright and license notices for third-party material intact.
