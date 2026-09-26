# Changelog

## 1.0.0

- Prepare the project for open-source distribution under MIT, preserving DeepSeek Harness attribution and third-party copyrights.
- Add a locked dependency inventory and bundled npm, Electron and Chromium license notices, with package-content gates.
- Replace workstation-specific acceptance and planning notes with deployment, architecture and contributor documentation.
- Add full-history secret scanning, dependency audit, source hygiene and license checks to CI.
- Require native desktop smoke, Linux Harness integration and all platform builds before release; remove build-only publication.
- Add credential-store and real SSH forwarding regression checks. Codex provider connection was confirmed working by the operator.

## 0.4.0

- Remember desktop passwords using OS encryption; allow forgetting credentials and reject insecure Linux storage fallback.
- Add built-in SSH password/private-key transport, explicit pinned host-key trust, and HTTP/WebSocket forwarding.
- Support local fixed server passwords and remote provider settings through narrowly scoped Harness profile patches.
- Return to connection settings on renderer-process crashes; investigate provider black screens without claiming a reproduced root-cause fix.
- Build-only release at the operator's request; no automated test suites run.

## 0.3.0

- Allow remote HTTP roots in the desktop client, with bilingual plaintext-transport warnings.
- Add a reusable local-config-driven systemd installer and `dsh-server` lifecycle, log, and port commands.
- Support explicit all-interfaces binding through a deployment overlay without editing Harness or user profile credentials.
- Add an opt-in build-only release mode. This release is built without running automated tests at the operator's request.

## 0.2.0

- Add Linux AppImage/deb and macOS Intel/Apple Silicon dmg/zip packaging alongside Windows NSIS.
- Add native-platform build automation and release checks requiring all desktop packages and the server plugin, with SHA-256 metadata.
- Exercise the packaged Linux client against a real Harness server and check bilingual connection-page interaction and window resizing.
- Update pnpm and fflate tooling to patched versions; make plugin installation scripts follow the manifest version.

## 0.1.0

- Provide an independently installable Cordis app-server bundle with authenticated protocol discovery and Linux directory browsing.
- Provide a sandboxed remote Electron client with server selection, transient authentication, protocol checks and server-independent lifecycle.
- Validate actual Harness sessions, streaming, tool execution, reconnect and history restoration on Linux; cross-build Windows x64 NSIS.
