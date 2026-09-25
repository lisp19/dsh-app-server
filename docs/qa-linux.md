# Linux desktop QA

The connection-page checks exercise the actual Electron renderer under Xvfb. They run against source by default; `DSH_ELECTRON_EXECUTABLE` selects an already packaged executable and omits the source application argument. Each run creates an isolated settings directory under ignored `.integration/` and removes it on completion.

```sh
xvfb-run -a node scripts/experience.mjs
npm run prepare:integration
xvfb-run -a node scripts/electron-integration.mjs
DSH_ELECTRON_EXECUTABLE="$PWD/apps/electron/dist/linux-unpacked/dsh-remote" xvfb-run -a node scripts/experience.mjs
DSH_ELECTRON_EXECUTABLE="$PWD/apps/electron/dist/linux-unpacked/dsh-remote" xvfb-run -a node scripts/electron-integration.mjs
DSH_ELECTRON_EXECUTABLE='/opt/DSH Remote/dsh-remote' xvfb-run -a node scripts/electron-integration.mjs
DSH_ELECTRON_EXECUTABLE='/opt/DSH Remote/dsh-remote' xvfb-run -a node scripts/experience.mjs
```

## Connection page

On September 25, 2026, source, unpacked Linux executable, and installed Debian package runs passed in English and Simplified Chinese. Version 0.2.0 was exercised at `apps/electron/dist/linux-unpacked/dsh-remote` and `/opt/DSH Remote/dsh-remote`. The script checked missing URL and token fields, malformed URLs, rejected non-root paths and query strings, and rejected remote HTTP addresses. Application errors used the selected language, cleared the token, and left the form available for another attempt. Native required-field and URL validation focused the invalid field. The token input remained a password field.

Keyboard checks covered forward and reverse traversal between language, address, token, and Connect, plus the Connect button's visible focus outline. Both locales passed at the normal 620 × 740 and minimum 480 × 640 native window sizes. No horizontal overflow, JavaScript page errors, or console errors were observed.

The inspected source screenshots were `artifacts/screenshots/experience-source/en-normal.png`, `zh-minimum.png`, and `en-minimum-focus.png`. At normal size, the heading, both fields, action, and footer fit in the window. At minimum size, the page scrolls vertically; the footer falls below the initial viewport, and long error text adds height. The Connect button remains reachable and has a distinct mint outline when focused. Chinese text rendered without missing-glyph boxes or overlapping fields. These are visual observations, not a full accessibility or screen-reader audit.

Packaged screenshots `experience-packaged/en-normal.png`, `zh-normal.png`, `en-minimum-focus.png`, and `zh-minimum-error.png` were also inspected and showed the same behavior. Error-state document heights were 679 px in English and 659 px in Chinese at minimum size; native menu space left approximately 612 px of renderer height.

Each run writes screenshots and `report.json` into `artifacts/screenshots/experience-source/` or `experience-packaged/`. Error screenshots capture the full document; focus and default screenshots capture the visible viewport. Artifacts are ignored by Git and can be regenerated with the commands above.

## Real Harness integration

`scripts/electron-integration.mjs` launches an isolated shipped Harness Web profile with the packed server plugin and a deterministic local model. Its assertions cover wrong-token rejection, authenticated GUI loading, renderer isolation, URL-only persistence, live assistant streaming, the remote directory picker, WebSocket reconnection, an in-flight server turn completing after Electron exits, and reopened conversation history after reauthentication. It uses a local HTTP loopback connection and does not establish production TLS, real-provider quality, or Windows behavior.

Both source and packaged real-server runs passed every assertion on September 25, 2026. The installed plugin fixture was refreshed with `npm run prepare:integration` after its version changed to 0.2.0; the integration script correctly rejected the outdated fixture before refresh.

Concurrent runs initially exposed a test-input readiness race: the first composer fill returned with empty text and without editor focus, while initialization APIs returned 200 and no renderer exception occurred. Each process used its own `xvfb-run -a` display. Read-only inspection found that a remote window is available to automation before its native show/settings-hide handoff, and the Harness Send button becomes enabled only when the input machine has adopted an actionable draft. Waiting for that button alone still reproduced the lost-input failure. The integration script now waits for the native window handoff, selects the editable plain-phase editor, clicks it before filling, and waits for enabled Send before Enter. A concurrent installed-package integration and UX run then passed. These waits use UI events and state rather than fixed delays; no production code changed.

The installed Debian package also passed functional integration followed by UX sequentially. Failure output includes recent API response paths/statuses and renderer errors, without request query strings or headers, to aid future diagnosis. The evidence establishes that the corrected automation passed the previously failing concurrent scenario; it does not identify which individual focus transition discarded the original input.
