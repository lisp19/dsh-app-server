# App Server Implementation Plan

> Execute with subagent-driven-development. Original repository is read-only. The user approved autonomous decisions, implementation and testing on 2026-09-25.

**Goal:** Deliver an independently installable Linux Harness plugin bundle and a Windows Electron client selecting a remote server.

**Architecture:** A Cordis plugin adds an authenticated `/api/app-server/info` endpoint to the existing Connection registry. A bundle selects the in-page directory picker. Electron authenticates in a fresh session partition, checks protocol compatibility, and loads the server's GUI without a Node bridge. Deployment uses loopback plus SSH forwarding or an HTTPS reverse proxy preserving Host.

**Tech stack:** ESM JavaScript with Node's built-in test runner, npm workspaces, published Harness 0.1.7-rc.2, Electron, electron-builder, Playwright for application automation. Runtime JSON is validated at ingress.

## Task 1: Independent workspace and server bundle

- [x] Create root `package.json`, `.gitignore`, `packages/server/package.json`, `packages/server/src/index.js`, and `packages/server/cordis.patch.yml`.
- [x] Export Cordis `name`, `inject = ['connection']`, and `apply(ctx)` registering an exact authenticated GET route through `ctx.connection.fetch.register` and `ctx.effect`.
- [x] Return `{ product: 'dsh-app-server', protocolVersion: 1, platform: process.platform }` with JSON content type and `Cache-Control: no-store`.
- [x] Pin peer compatibility to published Harness 0.1.7-rc.2 and use the real published Connection in host tests. Verify unauthorized rejection, authorized metadata, registration cleanup and bundle contents.
- [x] Run `npm test` and `npm pack --workspace packages/server --pack-destination artifacts`.

## Task 2: Electron remote client

- [x] Create `apps/electron/package.json`, `src/main.js`, `src/connection.js`, `src/security.js`, `src/preload.cjs`, and localized connection-page HTML/CSS/JS.
- [x] Accept only root HTTPS URLs or loopback HTTP; reject userinfo, query, fragments, ambiguous ports, unsupported schemes and non-root mounts. Keep token input separate and redact all failures.
- [x] On connect, create a fresh nonpersistent session, perform token-to-cookie exchange with net.request using manual redirect handling, then read the authenticated metadata endpoint. Enforce product and protocol version before creating the remote window.
- [x] Save only the server URL under Electron userData. Remote window has sandbox and contextIsolation enabled, nodeIntegration disabled, no preload, explicit permission denial, no popup windows and same-origin top-level navigation restrictions. Settings IPC accepts only the local settings main frame.
- [x] Add menu actions to return to connection settings and disconnect; close destroys only the client session/window. Failed requests map to bounded localized errors. Use deadline/cancellation for connection attempts and protect concurrent connects.
- [x] Add behavioral tests for URL policy, authentication, metadata validation and navigation policy; include executable Electron automation covering connection UI, remote isolation and server switching.
- [x] Configure Windows x64 NSIS and unpacked builds and Linux unpacked build for local smoke testing.

## Task 3: Real Harness integration and deployment

- [x] Install published Harness in a dedicated ignored integration directory in this repository; keep DSH_HOME, working directory and all generated state there.
- [x] Create `scripts/integration.mjs` to boot normal `dsh --profile` with the plugin bundle and deterministic model fixtures; verify actual API authentication, plugin metadata, GUI loading, sessions, filesystem/process execution and reconnection/lifecycle behavior.
- [x] Create `deploy/Caddyfile`, `deploy/dsh-app-server.service` and setup documentation using normal CLI profile/plugin installation. Preserve Host through TLS proxy and configure trusted authority. No alternate Node server entry point.
- [x] Run Electron automation against the real Host and record resulting evidence, separating any unavailable Windows-only checks.

## Task 4: Review and deliverables

- [x] Conduct independent specification review, then code quality/security review; fix findings and rerun affected checks.
- [x] Write README with exact install/run/build commands, authentication and SSH/HTTPS examples, filesystem location and unsupported local desktop integrations.
- [x] Produce plugin tarball, Windows client artifact where build environment permits, and verification report with hashes and commands actually executed.
- [x] Verify `git -C /home/lsp/deepseek-harness status --porcelain` stays empty and commit the independent repository.

## Acceptance mapping

Design requirements 1–2 map to Tasks 1 and 3; 3–5 map to Tasks 2 and 3; 6 maps to Tasks 1–3; 7 maps to Tasks 2 and 4; 8 applies to every task. A fake HTTP app alone does not establish Harness integration. A cross-built executable alone does not establish Windows runtime behavior.
