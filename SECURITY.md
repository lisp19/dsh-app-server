# Security

DSH App Server is a single-operator remote Harness client. Authenticated access grants the operator's server capabilities, including filesystem access and command execution. It does not provide tenant isolation.

Prefer a loopback listener with SSH forwarding or a trusted HTTPS reverse proxy. HTTP connections expose tokens, cookies, session content and model credentials to the network. Restrict all-interface listeners with firewall rules. Never disable Electron sandboxing or HTTPS certificate verification.

Each connection uses an in-memory browser session. Saved passwords use Electron safeStorage; Linux plaintext fallback is rejected. Private-key contents and authentication cookies are not persisted. Saved secrets are bound to their configured destinations. Use “Forget saved passwords” to remove them. Operating-system encryption cannot protect an already compromised account.

Verify SSH host fingerprints through a trusted channel before accepting them. Unexpected host-key changes are rejected. Built-in SSH requires server-side TCP forwarding permission; encryption extends to the SSH host, so prefer a target on that host's loopback interface.

An optional fixed password is read from an owner-only file. Use a long random password. The adapter does not add brute-force throttling; changing the password does not invalidate existing signed cookies. Startup URLs in service logs can contain authentication secrets. Do not attach unredacted logs, profiles or screenshots to reports. Model credentials entered in the GUI are stored by the server's credential provider.

## Reporting

Use the repository's [private vulnerability reporting](https://github.com/lisp19/dsh-app-server/security/advisories/new) if available. Otherwise contact the maintainer through an existing private channel before sharing details. Do not disclose credentials or exploitable details in public issues.

## Dependency updates

Audit both the desktop dependency tree and the separately installed Harness profile. Run `npm audit` after dependency changes and review upstream advisories. Lockfile overrides in this repository do not automatically apply to independently installed profiles or global packages. Compatibility patches are pinned to Harness `0.1.7-rc.2`; recheck authentication, Host/origin validation and runtime behavior before changing that version.
