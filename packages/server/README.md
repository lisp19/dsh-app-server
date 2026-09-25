# App Server plugin

Install this bundle into a Web-derived DeepSeek Harness profile. It provides authenticated client discovery at `GET /api/app-server/info`, selects the in-page Linux directory picker, and hides host-local “Open in application” controls. It uses the existing Host authentication, RPC, streams, and GUI.

Requires Harness `0.1.7-rc.2`. The supported client discovery protocol is version `1`. Installing this bundle does not expose a network listener or disable authentication; use an SSH tunnel or HTTPS reverse proxy in front of the loopback Web listener. The project README contains deployment instructions.

The `apply` registration belongs to the Cordis plugin lifecycle and is disposed when unloaded. Discovery sends no model-visible input and changes no Session formats.
