# Security

DSH App Server is a single-operator remote Harness client. Authenticated access grants the operator's server capabilities, including filesystem access and command execution. It does not provide tenant isolation.

Prefer a loopback listener with SSH forwarding or a trusted HTTPS reverse proxy. HTTP connections expose tokens, cookies, session content and model credentials to the network. Restrict all-interface listeners with firewall rules. Never disable Electron sandboxing or HTTPS certificate verification.

Each connection uses an in-memory browser session. Saved passwords use Electron safeStorage; Linux plaintext fallback is rejected. Private-key contents and authentication cookies are not persisted. Saved secrets are bound to their configured destinations. Use “Forget saved passwords” to remove them. Operating-system encryption cannot protect an already compromised account.

Verify SSH host fingerprints through a trusted channel before accepting them. Unexpected host-key changes are rejected. Built-in SSH requires server-side TCP forwarding permission; encryption extends to the SSH host, so prefer a target on that host's loopback interface.

A fixed gateway password is read from an owner-only file; installation generates one when no file is configured. Use a long random password. The gateway throttles login attempts and creates independent, host-bound sessions in memory. Restart after changing the password; restarting clears those sessions. Do not attach unredacted logs, profiles or screenshots to reports. Model credentials entered in the GUI are stored by the native server's credential provider.

Native DSH listens only on server loopback. The plugin obtains a bootstrap URL through the public `connection.authenticatedUrl` API and writes it to a private temporary file; the launcher exchanges it for a native cookie kept in server memory. Native cookies are not forwarded to the desktop. This integration does not read private authentication state or modify upstream package files. Protect the DSH home and the operating-system account: loopback binding does not isolate mutually untrusted local processes.

The desktop loads native GUI content through a connection-specific loopback bridge. A random header injected by the main process and strict Host/origin checks protect that bridge; it does not grant unauthenticated local processes access merely because they can reach its port. Preserve these guards, renderer isolation and both authentication boundaries when changing transport code.

## Reporting

Use the repository's [private vulnerability reporting](https://github.com/lisp19/dsh-app-server/security/advisories/new) if available. Otherwise contact the maintainer through an existing private channel before sharing details. Do not disclose credentials or exploitable details in public issues.

## Dependency updates

Audit both the desktop dependency tree and the separately installed Harness installation/profile. Installation resolves npm `@deepseek-ai/dsh@latest`, records its exact version and lockfile hashes in `installation.json`, and uses the official CLI to compose a fresh profile. The root lockfile does not inventory this dynamic native dependency tree. Root lockfile overrides do not apply to it. Run dependency audits in each installation and review upstream advisories. Recheck authentication, Host/origin validation, SSH and actual GUI behavior against the resolved version before release. A successful installation alone is not functional validation.
