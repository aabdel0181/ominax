# CLI reference (`ominax`)

The `ominax` command runs and manages T3 Code servers, background services, remote access, threads, workflows, and diagnostics. Run `ominax --help` or `ominax <command> --help` for full flags.

See [Install T3 Code](./install.md#command-line) for installation (`curl -fsSL https://github.com/aabdel0181/ominax/releases/latest/download/install.sh | sh`, or `irm https://github.com/aabdel0181/ominax/releases/latest/download/install.ps1 | iex` on Windows).

## Running and connecting

| Command                          | Description                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ominax [path]` / `ominax start` | Start a foreground server and open the web app (optionally in a project directory).                                              |
| `ominax serve`                   | Start the server without opening a browser (`--lan`, `--tailscale-serve`, `--host`, `--port`, `--base-dir`).                     |
| `ominax app [path]`              | Open a directory as a project/thread in the running desktop app.                                                                 |
| `ominax up`                      | Interactive setup for remote access (T3 Connect and/or LAN) plus background service (`--connect`, `--lan`, `--no-lan`, `--yes`). |
| `t3 connect`                     | Manage T3 Connect (`t3 connect`, `status`, `login`, `logout`, `link`, `unlink`).                                                 |
| `ominax status`                  | Show how other devices can reach this host (`--json`).                                                                           |
| `ominax pair`                    | Generate a one-time pairing URL / QR code (`--tailscale`, `--scope <scope>`).                                                    |

## Background service and updates

| Command                               | Description                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ominax service`                      | Manage the background service (`install`, `status`, `restart`, `uninstall`, `protect [--undo]`). See [Background service](./background-service.md). |
| `ominax update [version]`             | Update `ominax` and the service (`--allow-downgrade`, `--yes`).                                                                                     |
| `ominax install` / `ominax uninstall` | Install or remove the `ominax` launcher and background service (keeps `~/.ominax/userdata`).                                                        |

## Threads, projects, and workflows

| Command           | Description                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ominax thread`   | Script threads on the host (`start`, `send`, `show`, `list`; supports `--wait`, `--json`, `--worktree`, `--provider`, `--model`, `--option`). See [Host scripts](./outside-agents.md#host-scripts-ominax-thread). |
| `ominax project`  | Manage projects on the host (e.g. `ominax project add <path> --track <folder>`).                                                                                                                                  |
| `ominax workflow` | Start and steer durable workflows (`start`, `list`, `show`, `resume`, `cancel`, `questions`, `signal`, `withdraw`, `hooks`, `store`). See [Workflows](./workflows.md).                                            |

## Environments, auth, themes, and policy

| Command              | Description                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ominax environment` | Link or manage peer environments (`ominax environment link <addr> --pairing-code <code> --access <mode>`, `--from <file>`).                            |
| `ominax auth`        | Manage pairing codes, sessions, and T3 Connect device approvals (`pairing create`, `session list/revoke/issue`, `connect-device list/approve/revoke`). |
| `ominax theme`       | Manage server-published themes (`set <id>`, `clear`, `show`). See [Appearance](./appearance.md#environment-themes).                                    |
| `ominax policy`      | Validate, inspect, and generate MDM/GPO templates for [managed policies](./managed-policy.md) (`check`, `show`, `settings`, `templates`).              |

## Diagnostics and maintenance

| Command                | Description                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ominax doctor`        | Inspect database size and reclaim disk space (`--dry-run`, `--fix`).                                       |
| `ominax browser setup` | One-time Linux host setup (AppArmor sandbox profile, libraries, fonts) for the headless preview browser.   |
| `ominax trace summary` | Summarize local server trace latency and errors (`--since 30m`, `--limit 50`).                             |
| `ominax triage`        | Launch Claude Code, Codex, or Antigravity in your terminal with the T3 triage playbook.                    |
| `ominax feedback`      | Send or inspect agent feedback reports (`list [--json]`, `--kind`, `--subject`, `--expected`, `--actual`). |
