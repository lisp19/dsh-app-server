# Built-in SSH transport

The desktop client can connect to the existing DSH App Server HTTP and WebSocket service through SSH. Select SSH transport, enter the SSH host, port (usually 22), username, and either a password or an absolute private-key file path. Encrypted private keys also need their passphrase.

The server URL is the address reachable **from the SSH host**. For this deployment use `http://127.0.0.1:3080/` (replace the port if configured differently). SSH forwarding must be permitted by the SSH server. The app-server password/access token is still required: SSH authentication and app-server authentication are separate.

“Remember password” saves the app-server password, SSH password or key passphrase using OS encryption after a successful connection. The private-key path is saved, not the key contents. Windows uses DPAPI; Linux requires a supported system keyring and never falls back to plaintext. “Forget saved passwords” removes saved secrets but preserves the endpoint and trusted host fingerprints.

Trust pins live in `ssh-hosts.json` in Electron's application userData directory (under `%APPDATA%` on Windows). If a host key changes legitimately, close the client, independently verify the new fingerprint, and remove only that host/port entry before reconnecting. Do not delete pins to bypass an unexplained mismatch.

Verify the displayed SSH SHA256 host-key fingerprint against a trusted source before approving a new host. Host-key verification is mandatory; an unexpected key must not be silently accepted. The desktop main process owns trust decisions and persisted fingerprints. The transport helper does not consult OpenSSH `known_hosts` or SSH config files.

HTTP requests and WebSocket connections share an ephemeral listener bound to `127.0.0.1` on the desktop. Each local connection opens an SSH `direct-tcpip` channel to the configured target. No shell command or remote process is started. SSH encrypts traffic between the desktop and the SSH host; traffic from that host to a separate HTTP target is ordinary HTTP. Prefer a target on the SSH host's loopback interface.

## Transport API

`validateSSH(input)` returns `{ host, port, username, auth, privateKeyPath? }`, where `auth` is `password` or `key`. It strips credentials and unrelated fields. Malformed settings throw `ConnectionError('sshConfig')`.

`await openSSHTunnel({ ssh, password, passphrase, targetURL, signal, verifyHost, onDisconnect })` returns `{ url, close }`. `url` is a root HTTP URL on the ephemeral loopback listener. `targetURL` accepts a string or URL object. `verifyHost({ host, port, fingerprint })` may be asynchronous and must return exactly `true` to accept the host key. Fingerprints use the canonical OpenSSH `SHA256:` format without base64 padding.

`close()` is synchronous and idempotent: it cancels pending listening, destroys local sockets and forwarding channels, and destroys the SSH connection. Aborting the supplied signal does the same, including during setup. Intentional closure or abort does not call `onDisconnect`. An existing `ConnectionError` abort reason is preserved; other abort reasons become `cancelled`.

Unexpected SSH disconnection, listener failure, or forwarding rejection closes the entire tunnel and calls `onDisconnect(ConnectionError('sshNetwork'))` once after opening. A remote connection refusal or disabled SSH forwarding is reported this way. Setup errors reject with sanitized `sshConfig`, `sshAuth`, `sshHostKey`, or `sshNetwork` codes; raw errors and secrets are not exposed. The caller should cancel its active HTTP authentication attempt when it receives a disconnect notification.

## Limits

- SSH targets accept root `http://` URLs only. Use the existing direct transport for HTTPS. The tunnel does not rewrite TLS server names, HTTP Host headers, redirects, or absolute links.
- Password and private-key authentication are supported; SSH agents, keyboard-interactive/MFA prompts, certificates, jump hosts, and OpenSSH configuration aliases are not.
- SSH host addresses accept DNS names and unbracketed IPv4/IPv6 literals. Private-key paths must be absolute and readable by the desktop process.
- The helper never persists passwords, passphrases, or private-key contents. Credential storage and host-key pinning belong to the desktop main process.
- A tunnel loss requires reconnecting. There is no automatic reconnect or remote process startup.
- The loopback listener is reachable by other processes on the desktop while connected; app-server authentication remains necessary.

The forwarding and host-verification implementation follows the [ssh2 client API](https://github.com/mscdex/ssh2#client-methods).
