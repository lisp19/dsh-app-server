# Provider compatibility

The dedicated server profile currently uses Harness `0.1.7-rc.2`. Its Models
settings page lists the pi-ai provider catalog, including `openai-codex`, but the
installed browser UI offers an API-key editor only. A provider appearing in that
catalog does not mean the UI supports its complete authentication flow.

OpenAI Codex requires OAuth. The installed `@deepseek-ai/dsh-llm-pi-ai` Host
adapter contains OAuth authorization flows, but the installed client composition
does not include a provider authorization UI. Saving an API key or an empty
`openai-codex` profile does not establish a Codex OAuth session. Do not enter a
ChatGPT password into the API-key field.

## Black-screen investigation

Read-only navigation against the dedicated live profile reproduced neither a
renderer exception nor a black screen when selecting `openai-codex` and opening
Customized settings. A separate disposable profile using the same installed
packages also rendered successfully after saving the provider with an empty key,
and after saving a dummy key over LAN HTTP and reloading. The LAN page was an
insecure context with `crypto.randomUUID` unavailable; those operations still
completed without a page exception.

These diagnostics did not send model requests or perform external OAuth, and
did not modify the live profile's provider settings or credentials. They do not
establish that Codex authentication works or resolve a black screen reached by a
different action. An exact trigger, client build, and renderer error are needed
before adding a provider compatibility patch. Electron navigation restrictions
should not be relaxed on the assumption that they caused this symptom.
