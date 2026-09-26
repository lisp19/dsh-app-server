# App Server plugin

Cordis bundle for a Web-derived [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) profile. It provides authenticated client discovery at `GET /api/app-server/info`, selects the server directory browser and hides host-local “Open in application” controls. Authentication, RPC, streams, model execution and sessions remain owned by Harness.

Requires Harness `0.1.7-rc.2`; discovery protocol version is `1`. The bundle does not create a network listener or disable authentication. Remote-settings and fixed-password compatibility patches are separate deployment steps.

See the [project README](https://github.com/lisp19/dsh-app-server#readme) for installation and the [service guide](https://github.com/lisp19/dsh-app-server/blob/main/docs/server-management.md) for deployment. Plugin registrations are disposed through the Cordis lifecycle when the bundle unloads.
