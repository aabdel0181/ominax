# Running T3 Code in the background

Run T3 Code as a background user service on Linux, macOS, or Windows so your host stays reachable without keeping a terminal open.

## Manage the service

Install the `ominax` CLI first ([Command line](./install.md#command-line)), then run these commands on the host machine:

| Task                                    | Command                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| Set up access from other devices        | `ominax up`                                                       |
| Check how other devices reach it        | `ominax status`                                                   |
| Install and start (or repair)           | `ominax service install`                                          |
| Check status and log path               | `ominax service status`                                           |
| Update to a newer release               | `ominax update`                                                   |
| Restart                                 | `ominax service restart`                                          |
| Stop and remove from startup            | `ominax service uninstall`                                        |
| Remove service, launcher, and downloads | `ominax uninstall` (keeps `~/.ominax/userdata` and `service.env`) |

- Pairing codes are never written to logs; run `ominax pair` or `ominax up` on the host to connect a device.
- `ominax update` asks before restarting (pass `--yes` in scripts). Pin a version with `ominax update 0.0.42`, switch tracks with `--channel nightly`, or downgrade with `--allow-downgrade`.

## Local network access

New services bind to localhost only. Run `ominax up --lan` (sets `T3CODE_LAN=true` in `service.env`) to listen on LAN and Tailscale addresses for direct desktop/mobile connections, or `ominax up --no-lan` to disable it. Anyone on that network can reach the port (gated by pairing). `T3CODE_HOST` overrides `T3CODE_LAN`. Hosted `app.t3.codes` always uses T3 Connect.

## Configure the service environment

Add `KEY=VALUE` entries to `service.env` in your T3 home directory (`~/.ominax/service.env` by default). Values are literal (quote spaces or `#`; no shell expansion) and survive installs and updates.

```dotenv
T3CODE_PORT=3773
T3CODE_HOST=127.0.0.1
```

- `PATH`, `T3CODE_HOME`, `T3_BOOT_SERVICE_UNIT`, and `T3_SERVICE_LAUNCHER_CONTEXT` cannot be overridden here.
- Run `ominax service restart` after editing (and `chmod 600 ~/.ominax/service.env` if it holds secrets).

## Platform support

- **Linux**: Requires systemd user services with lingering enabled so T3 Code starts at boot and survives logout.
- **macOS**: Starts at login, stops at logout. Keep the Mac logged in and awake for unattended access. If agents can't read Desktop/Documents/Downloads, grant Full Disk Access to the `ominax` path in `~/Library/LaunchAgents/io.github.aabdel0181.ominax.service.plist`.
- **Windows**: Runs windowless via Task Scheduler (`ominax-<domain>-<user>`) while signed in and auto-restarts on exit. Lock the screen instead of signing out for unattended access.

> Note: Signing out of T3 Connect does not stop or uninstall the background service.

## Keep the server responsive under memory pressure (Linux)

On Linux, agents run at lower priority than the server, but heavy memory use can still trigger the OOM killer. Run as your normal user:

```sh
ominax service protect
```

It previews system changes, asks for confirmation and `sudo`, and optionally protects Tailscale and SSH too. Run `ominax service restart` for OOM-killer protection to take effect, or `ominax service protect --undo` to remove it.

## Troubleshooting

Run `ominax service status` on the host to see the log path and health checks:

| Status                                 | Fix                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `linger-disabled`                      | Run `sudo loginctl enable-linger "$(id -un)"` (or `ssh -t your-server '...'`), then retry setup as your normal user. Never run T3 Code as root. |
| `linger-unavailable`                   | Check `loginctl show-user "$(id -un)" --property=Linger` and verify `systemd-logind`.                                                           |
| `user-manager-unavailable`             | Run `systemctl --user status` in a login session to verify systemd user support.                                                                |
| `service-disabled` / `service-stopped` | Check the log and `systemctl --user status ominax.service`, then run `ominax service install`.                                                  |
| `restart-pending`                      | Run `ominax service restart` to switch to the newly installed version.                                                                          |

For T3 Connect issues, see [T3 Connect troubleshooting](./t3-connect-troubleshooting.md).

## Reclaim database space

T3 Code automatically prunes old internal history while keeping conversations. Older databases that still hold freed space show a **Reclaim** button in **Settings → Maintenance** when at least 1 GiB is reclaimable (pauses the server/agents during repair).

For manually started servers (or CLI use), stop any hand-started server or desktop app and run:

```sh
ominax doctor          # Interactive repair (auto-stops/restarts a background service)
ominax doctor --dry-run
ominax doctor --fix    # Non-interactive recommended repairs
```

- Needs free disk space of ~2× active data size (in `TMPDIR`/`/var/tmp` and beside the database). Large databases can take over an hour.
- `ominax doctor` optionally offers to remove the legacy pre-0.1.0 `state.sqlite` backup only when all active projects and threads exist in the current database (`--fix` never deletes it automatically).
