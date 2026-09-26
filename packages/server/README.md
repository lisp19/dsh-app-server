# App Server plugin

Plugin and independent authentication gateway for a Web-derived [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) profile. The plugin registers authenticated discovery and uses the public `connection.authenticatedUrl` API to write a private bootstrap file for the launcher. Native DSH retains RPC, streams, model execution, sessions and its original GUI.

The installer resolves npm `@deepseek-ai/dsh@latest`, creates a fresh default `web` profile and installs plugins through the official CLI. No upstream package files are modified. The launcher binds native DSH to loopback and exposes this project's gateway with fixed-password authentication and independent memory-only sessions. Gateway discovery uses protocol `2`; the plugin's native discovery endpoint remains protocol `1` and is not the desktop's public entry point. Missing public bootstrap/authentication capabilities cause startup to fail.

This package does not bundle native DSH or its dependency tree. Installation records the exact resolved version and lockfile hashes for separate validation and license/security review. Existing custom plugins are not automatically migrated.

See the [project README](https://github.com/lisp19/dsh-app-server#readme) for installation and the [service guide](https://github.com/lisp19/dsh-app-server/blob/main/docs/server-management.md) for deployment. Plugin registrations are disposed through the Cordis lifecycle when the bundle unloads.
