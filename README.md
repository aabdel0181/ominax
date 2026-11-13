# OminaX

OminaX (formerly T3 Learn) is a fork of [T3 Code](https://github.com/pingdotgg/t3code) for learning with AI.

When a reply uses something you don't know yet, highlight it and choose **Ask in side chat** (⌥⌘S on a Mac, Ctrl+Alt+S elsewhere). A side chat opens next to the lesson. It sees your highlight and a short summary of the lesson, and nothing you say in it lands in the lesson. Side chats nest, so you can follow a question as deep as it goes. The side-chat header's map toggle (⌥⌘G on a Mac, Ctrl+Alt+G elsewhere) shows where you are without leaving the chat. Press **Done** to climb back out: the AI writes a short note, and your next lesson message carries it so the lesson picks up where you left off. The first time you open OminaX, a short guide walks you through this; open it again from Settings.

See [Side chats](docs/user/side-chats.md) for settings and provider details.

### Install

**macOS and Linux**

```bash
curl -fsSL https://github.com/aabdel0181/ominax/releases/latest/download/install.sh | sh
```

**Windows** (in PowerShell)

```powershell
irm https://github.com/aabdel0181/ominax/releases/latest/download/install.ps1 | iex
```

OminaX opens when the installer finishes. After that, open it like any other app; it updates itself. You also need at least one provider set up, such as Claude Code or Codex (see [Sign in to an agent](#sign-in-to-an-agent)).

The installer uses `OMINAX_*` environment variables. The old `T3LEARN_*` names still work, and `t3-learn` remains a command alias for `ominax`.

**Already using T3 Code?** Run the same command. OminaX installs next to T3 Code instead of over it, and keeps its own projects and settings in `~/.ominax`. T3 Code keeps its threads, settings, updates and `t3` command, and both apps can run at once. Providers you're already signed in to work in both.

<details>
<summary>Other ways to install, and how to remove it</summary>

- **Download it yourself** from [Releases](https://github.com/aabdel0181/ominax/releases/latest): `.dmg` for macOS, `.exe` for Windows, `.deb` or `.AppImage` for Linux. These builds are not signed. macOS blocks the app the first time you open it: go to **System Settings → Privacy & Security** and choose **Open Anyway**. Windows may warn that it doesn't recognize the app: choose **More info → Run anyway**. The install command avoids both prompts.
- **macOS updates:** because the app isn't signed, macOS may ask once after an update to let OminaX use its saved keychain item. Choose **Always Allow**. Screen Recording permission, used for window capture, has to be turned on again.
- **Linux:** the command installs the `.deb` where `apt` and `sudo` are available, so the app keeps Chromium's sandbox, and an AppImage in your home folder otherwise. Set `OMINAX_FORMAT=appimage` or `OMINAX_FORMAT=deb` to choose.
- **A specific version:** set `OMINAX_VERSION`, for example `OMINAX_VERSION=0.1.3-learn.1`.
- **Remove it:** on macOS and Linux, run the install command with `sh -s -- --uninstall` in place of `sh`. On Windows, uninstall **OminaX** from **Settings → Apps**. Your projects and settings stay in `~/.ominax`; delete that folder to remove them too.
- **From source:** you need [`vp`](docs/operations/development.md#first-checkout). Run `vp i`, then `vp run --filter t3 build`, then `vp env exec -- node apps/server/dist/bin.mjs serve --base-dir ~/.ominax`, and open the pairing URL it prints.

</details>

### Updating

New OminaX versions are released automatically from `main` after CI and the install tests pass. The app shows an update button that updates the app and its connected server together. On the server box, update the launcher with `ominax update --yes`; with the plain CLI, point `T3CODE_HOME` at `~/.ominax` first.

The phone app pairs with OminaX the same way it pairs with T3 Code. T3 Connect isn't available in OminaX's builds. To use OminaX's command line, choose **Install** next to **ominax command** in **Settings → About**.

**Want an agent to set it up, with your T3 Code chats along?** Give it [Set up OminaX with an agent](docs/user/ominax-agent-setup.md).

---

_The rest of this README is upstream T3 Code's._

<p align="center">
  <a href="https://t3.codes">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="80" height="80" alt="T3 Code logo" />
  </a>
</p>

<h1 align="center">T3 Code</h1>

<p align="center">The open-source control plane for coding agents.</p>

<p align="center">
  <a href="https://t3.codes/download"><strong>Download</strong></a> ·
  <a href="https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824">iOS</a> ·
  <a href="https://play.google.com/store/apps/details?id=com.t3tools.t3code">Android</a> ·
  <a href="https://app.t3.codes">Web</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://discord.gg/jn4EGJjrvv">Discord</a>
</p>

<p align="center">
  <a href="https://t3.codes">
    <img src="./.github/readme/hero.webp" width="100%" alt="T3 Code on desktop with a finished Claude thread, next to the phone app asking to approve a command from Codex" />
  </a>
</p>

T3 Code runs the coding agents on your machine and gives them one fast interface. Start a thread at your desk, then approve the next step from your phone.

It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. If an agent is set up on your computer, T3 Code can control it.

## What you get

- **Your subscriptions.** T3 Code does not resell tokens. It drives the agents you are already signed in to.
- **Every agent in one place.** Change models in the middle of a thread. Let Claude hand a task to Codex.
- **Desktop, web, and phone.** One server, and every client shows the same threads. There are apps for iOS and Android.
- **Remote ready.** Run agents on any machine. Connect over your local network, Tailscale, or [T3 Connect](./docs/user/remote-access.md).
- **Git built in.** Each thread can work in its own worktree. Review the diff, then commit, push, and open a pull request with one button.
- **Fast.** Performance is a feature here. We measure it, and we treat a dropped frame as a bug.
- **Open.** MIT licensed. If you don't like something, fork it.

## Install

### Desktop app

[Download T3 Code](https://t3.codes/download) for macOS, Windows, or Linux. You can also use a package manager:

| Platform       | Command                                                              |
| -------------- | -------------------------------------------------------------------- |
| macOS          | `brew install --cask t3-code`                                        |
| Windows        | `winget install T3Tools.T3Code` or `scoop install extras/t3code`     |
| Arch Linux     | `yay -S t3code-bin`                                                  |
| Nix            | `nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code`         |
| Debian, Ubuntu | `.deb` from [Releases](https://github.com/pingdotgg/t3code/releases) |

### Command line

This installs the `t3` command. Run `t3` to start the server and open the web app.

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

To try it once without an install, run `npx t3@latest`.

### Phone

Get the app from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code). Then follow [remote access](./docs/user/remote-access.md) to connect it to your computer.

### Sign in to an agent

T3 Code needs one agent that is installed and signed in. For example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.

[Provider setup](./docs/user/install.md#providers) has the steps for each agent. [Install T3 Code](./docs/user/install.md) covers nightly builds, AppImage, WSL, and NixOS.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the tool that you want.

## Documentation

- [Install and first run](./docs/user/install.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Connect outside agents over MCP](./docs/user/outside-agents.md)
- [FAQ](./docs/user/faq.md)

[All docs](./docs/README.md) has the full list.

## Contributing

We have limited review capacity. Small, focused fixes are the most likely to be merged. Features need an approved discussion first.

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you report a bug or open a pull request.
- Put feature requests in [Ideas](https://github.com/pingdotgg/t3code/discussions/categories/ideas).
- Build from source with the [development runbook](./docs/operations/development.md#first-checkout). The [architecture overview](./docs/internals/overview.md) explains how it works.
- Get help in [Discord](https://discord.gg/jn4EGJjrvv).

## License

[MIT](./LICENSE)
