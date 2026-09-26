# Security

This is a single-operator remote Harness client. Server access grants the operator's Harness capabilities, including server filesystem and command execution. Do not expose it as an untrusted multi-user service.

Use loopback with SSH forwarding or trusted HTTPS reverse proxying. Keep launch tokens out of URLs shared in reports, screenshots and issue text. The client stores only its last server URL; fresh connections use memory-only sessions. Never disable Electron sandboxing or certificate validation to work around deployment errors.

Starting with v0.3.0, remote HTTP is also accepted for explicitly trusted LAN/VPN deployments. HTTP does not encrypt launch tokens, authentication cookies, model credentials entered in the GUI, or session content. An all-interfaces listener exposes the service on every IPv4 interface; restrict access with host/network firewall policy and do not forward this port to the public Internet. Token authentication and the Host/origin checks remain enabled.

Report suspected vulnerabilities privately to the repository owner `lisp19` through an existing trusted channel. Do not post credentials or exploit data in issues. Only maintainers with repository access should receive sensitive reports.

Run `npm audit` when updating dependencies. The standalone client packages contain no Harness server runtime; server dependency security must also be managed on the Linux deployment. Updates remain pinned to the supported Harness API version until compatibility has been tested.

This repository pins patched pnpm and overrides transitive fflate to 0.8.3 for its local Harness runtime. `npm audit` reported zero findings on September 25, 2026. A separately installed global Harness does not inherit these overrides; audit and update that installation independently before processing untrusted Office/archive inputs. The supplied local acceptance installation uses this repository's patched runtime.
