# DSH Remote

Electron client for DSH App Server on Windows, Linux and macOS. Run `npm ci` and `npm start` from the repository root. Deployment instructions are in the [project README](../../README.md).

Connect to an HTTP or HTTPS root URL, or use built-in SSH forwarding to an HTTP target. Enter the app-server token/password separately from SSH credentials. HTTP direct connections are intended for trusted LAN/VPN use. HTTPS certificate validation is mandatory.

The client exchanges the token for a session cookie, verifies `/api/app-server/info`, then opens the server's Web GUI. Each connection uses an in-memory browser session. Remote content is sandboxed, has no Node integration or preload, and is restricted to the selected origin. Local IPC accepts only the settings window's main frame. The optional password store uses OS encryption and rejects Linux plaintext fallback; authentication cookies and private-key contents are not persisted.

The Connection menu disconnects or changes servers. Closing the app leaves the server and its tasks running. Server paths and terminals refer to the server machine. Language selection controls the connection page and native menu; Harness manages the remote GUI language.

Run `npm test --workspace apps/electron` for behavioral tests and `npm run test:smoke --workspace apps/electron` for Electron smoke tests. Headless Linux requires `xvfb-run -a` for GUI tests. Packaging and actual Harness integration checks are documented in the [development guide](../../docs/development.md).
