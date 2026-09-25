# Contributing

Use Node.js 24 and `npm ci`. This private repository follows conventional commits and immutable semantic version tags. The reference Harness repository is read-only; changes belong here.

Create a short-lived branch from `main`, change only the relevant components, and run `npm test`. For authentication, UI or lifecycle work, also run the Electron smoke, `npm run prepare:integration`, `npm run test:integration`, and `xvfb-run -a npm run test:electron` on Linux. Use `DSH_ELECTRON_EXECUTABLE=/absolute/path/to/dsh-remote` for the packaged-app check. Run `xvfb-run -a node scripts/experience.mjs` for connection-page interactions and screenshots. Use pull requests for subsequent changes.

## Releases

1. Update root, client and plugin versions together and regenerate `package-lock.json` with `npm install --package-lock-only`.
2. Add `docs/releases/v<VERSION>.md`, update the changelog, and pass the full native build workflow on the candidate commit.
3. Review the diff and generated package contents. Never commit tokens, cookies, model credentials, local profiles or test data.
4. Create an annotated `v<VERSION>` tag on the reviewed commit and push it. The release workflow rebuilds/tests on native runners, checks all required artifacts and versions, then publishes assets and hashes. A failed platform prevents publication.
5. Verify the private release with `gh release view`, download its assets and run `sha256sum -c SHA256SUMS` on Linux. Do not replace assets of a published version; ship a new patch version.

The baseline 0.1.0 predates multi-platform CI and is published with its original locally verified artifacts. Packages are unsigned; code signing requires separately provisioned publisher credentials. Tests use deterministic model fixtures, not paid external API calls.
