# Product usage data and diagnostics

OminaX sends no product usage events and no relay connection traces by default, and never sends
usage events to T3 Code. To send them to your own PostHog server, set all three in the server's
environment:

- `T3CODE_TELEMETRY_ENABLED=true`
- `T3CODE_POSTHOG_KEY` to your PostHog project key
- `T3CODE_POSTHOG_HOST` to your PostHog URL, for example `https://posthog.example.ts.net`

Without a key and host, nothing is sent. Prompts, responses, lesson text, the text of quiz answers, file contents, and credentials are never included (unless you explicitly approve an [agent feedback](#agent-feedback) card with conversation text attached).

## Product usage events

The server sends usage events to your PostHog server under a hashed random install ID (plus a hashed T3 Connect account ID when signed in, and random client device IDs). Events contain provider, catalog model name (non-catalog models report as custom), reasoning effort, permission mode, turn/request outcome, duration, release channel, and token counts. Lesson features are counted too: new lessons, side chats opened and finished, quiz cards and whether each answer was right, What's new actions, viewing and changing the knowledge map, and changes to courses.

## Disable telemetry

- **Server / CLI**: Leave `T3CODE_TELEMETRY_ENABLED` unset or set it to `false`, or set `DO_NOT_TRACK=1` before starting (`DO_NOT_TRACK=1` takes precedence over `T3CODE_TELEMETRY_ENABLED=true`). CI environments (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `JENKINS_URL`) disable telemetry by default unless `T3CODE_TELEMETRY_ENABLED=true`.
- **Desktop app**: On macOS and Linux, the desktop app reads `T3CODE_TELEMETRY_ENABLED`, `T3CODE_POSTHOG_KEY`, `T3CODE_POSTHOG_HOST`, and `DO_NOT_TRACK` from your shell profile (for example `~/.zshrc`), so it sends events even when opened from the Dock or a launcher. On Windows, set them as user environment variables; a WSL backend receives them too. Restart the app after changing them.
- **Managed policy**: Administrators can set `"telemetry": false` in [managed policy](./managed-policy.md#other-capabilities) for servers and desktop apps.
- **Mobile app**: Toggle **Send crash reports** and **Send connection traces** separately in **Settings → About T3 Code → Diagnostics**.

## Relay connection diagnostics

T3 Connect sends connection timings, request paths, environment/thread IDs, and error types (no addresses, logs, or stack frames) to Axiom. Disabled by the server telemetry opt-outs above or by `T3CODE_OTEL_SDK_DISABLED` / `OTEL_SDK_DISABLED`.

## Agent feedback

Optional tool for agents to report OminaX bugs or missing capabilities. Reports go to the PostHog server set above, like product events, never to T3 Code, although the app's own copy still names the T3 team. Configure in **Settings → Labs → Agent feedback**:

- **Off** (default): Feedback tools and `ominax feedback` are disabled.
- **When I ask**: Agents submit a report only when you ask, shown as an interactive approval card before anything leaves your machine.
- **Automatic**: Also sends minimal automated reports (problem kind + tool/command name only—no text or conversation) when an agent hits a T3 tool failure; enables `ominax feedback` CLI reporting (up to 10/hour).

Approval cards show exact payloads (expected/actual/workaround, turn outline with no text, and optional **Include the conversation** up to 16 KB). File paths, usernames, hostnames, git remotes, and secret-like strings are scrubbed before saving, and reports use one-off random IDs. Inspect local reports with `ominax feedback list [--json]`.

## Agent activity for mobile notifications

**Settings → Sharing & access → Publish agent activity** sends project/thread titles, model names, and turn status to the T3 Connect relay for [mobile notifications and live activities](./mobile-notifications.md). This is independent of telemetry—turn it off directly on the host if you don't want it.

## Export diagnostics to your own OpenTelemetry receiver

Open **Settings → Maintenance → Diagnostics** (per environment) and enter OTLP HTTP endpoints (e.g. `http://localhost:4318/v1/traces`), save, and restart the server. Use **Test** to verify connectivity.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` env vars override saved settings (use `T3CODE_OTLP_HEADERS` / `T3CODE_OTLP_PROTOCOL=http/protobuf` or the standard `OTEL_EXPORTER_OTLP_*` equivalents for auth and protobuf).
