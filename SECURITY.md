# Security

This is a single-operator remote Harness client. Server access grants the operator's Harness capabilities, including server filesystem and command execution. Do not expose it as an untrusted multi-user service.

Use loopback with SSH forwarding or trusted HTTPS reverse proxying. Keep launch tokens out of URLs shared in reports, screenshots and issue text. The client stores only its last server URL; fresh connections use memory-only sessions. Never disable Electron sandboxing or certificate validation to work around deployment errors.

Report suspected vulnerabilities privately to the repository owner `lisp19` through an existing trusted channel. Do not post credentials or exploit data in issues. Only maintainers with repository access should receive sensitive reports.

Run `npm audit` when updating dependencies. The standalone client packages contain no Harness server runtime; server dependency security must also be managed on the Linux deployment. Updates remain pinned to the supported Harness API version until compatibility has been tested.
