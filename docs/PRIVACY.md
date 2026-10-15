# Privacy

Vessel runs entirely on your PC. It has no account, no server of its own, no analytics and no crash reporting.

## What Vessel reads

| Provider | What is read | Why |
|---|---|---|
| Codex | The sign-in file Codex already saved (`~/.codex/auth.json`, or `CODEX_HOME`) | To ask for your usage numbers |
| Claude | `~/.vessel/claude-code-usage.json`, written by Vessel's status-line hook | To read your usage limits |
| Gemini | Nothing. Gemini app usage cannot be read automatically | |

Vessel reads these files only after you accept the first-run notice **and** press Connect for that provider.

## What Vessel sends

- **Codex:** one request to an unofficial ChatGPT page (`chatgpt.com/backend-api/wham/usage`), using your saved Codex login. That page is not documented and may change or stop working without notice.
- Nothing else leaves your PC. Your tokens are never logged and never stored by Vessel.

## What Vessel changes on your PC

- **Claude Code:** when you connect Claude, Vessel writes `~/.vessel/vessel-statusline.ps1` and adds a `statusLine` entry to `~/.claude/settings.json`.
  - A backup (`settings.json.bak-<time>`) is saved first. The newest 3 are kept.
  - If you already have a different status line, Vessel asks before replacing it.
  - **Disconnect** removes Vessel's entry (after another backup) and deletes Vessel's exported data.
- **Start with Windows:** a single entry in the current user's `Run` registry key, only if you turn it on.
- **App data:** settings, the last known numbers and alert memory are kept in `%APPDATA%\app.vessel`.

## Removing everything

1. Disconnect each provider in Vessel's settings.
2. Uninstall Vessel.
3. Delete `%APPDATA%\app.vessel` and `%USERPROFILE%\.vessel`.
