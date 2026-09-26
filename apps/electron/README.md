# DSH Remote

Electron client for DSH App Server on Windows, Linux and macOS. Run `npm ci` and `npm start` from the repository root. Deployment instructions are in the [project README](../../README.md).

Connect to the gateway's HTTP or HTTPS root URL, or use built-in SSH forwarding to an HTTP target. Enter the app-server fixed password separately from SSH credentials. HTTP direct connections are intended for trusted LAN/VPN use. HTTPS certificate validation is mandatory.

The client exchanges the password for a gateway session cookie, verifies protocol `2` at `/api/app-server/info`, then loads the native server GUI through a connection-specific loopback HTTP/WebSocket bridge. The main process supplies a random private header; the bridge enforces Host/origin checks and keeps upstream cookies out of the renderer. GUI JavaScript is not rewritten. Each connection uses an in-memory browser session. Remote content is sandboxed, has no Node integration or preload, and is restricted to the bridge origin. Local IPC accepts only the settings window's main frame. The optional password store uses OS encryption and rejects Linux plaintext fallback; authentication cookies and private-key contents are not persisted.

Desktop packages contain the application, Electron and SSH/runtime dependencies, but no DSH packages or bundled DSH GUI. The server installs native DSH independently from the selected npm channel (`latest` by default, or `next`).

The Connection menu disconnects or changes servers. Closing the app leaves the server and its tasks running. Server paths and terminals refer to the server machine. Language selection controls the connection page and native menu; Harness manages the remote GUI language.

Run `npm test --workspace apps/electron` for behavioral tests and `npm run test:smoke --workspace apps/electron` for Electron smoke tests. Headless Linux requires `xvfb-run -a` for GUI tests. Packaging and actual Harness integration checks are documented in the [development guide](../../docs/development.md).
