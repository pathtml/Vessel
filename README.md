# Ai Usage Dock

A local Windows Tauri + React system-tray app for tracking remaining AI subscription usage.

## Product Rules

- Tracks one active provider in the tray at a time.
- Default tray display period is `5h`.
- Supports provider periods: `5h`, `daily`, `weekly`, `monthly`, and `custom`.
- Does not scrape provider pages, read browser cookies, ask for passwords, automate login, or fake official usage.
- If official or local supported status sync is unavailable, show manual setup and label the data as manual.
- If no limit is configured, the tray stays neutral and the UI asks the user to set a limit.

## Source Badges

- `Official`: usage comes from a documented official API or supported local status source. This MVP does not enable this badge by default.
- `Local`: usage comes from a supported local provider session or export, such as Codex CLI auth or Claude Code status-line data.
- `Manual`: the user manually sets limit and used amount.
- `Estimated`: usage is estimated only from activity this app can see.
- `Unsupported`: official usage is unavailable and tracking is not configured.

## What Works

- Quiet Tauri tray app startup with the dashboard hidden by default.
- Native tray menu: Open Dashboard, Add Usage, Reset Current Period, Settings, Quit.
- Active-provider tray display with colored percentage icon fallback.
- First-time setup walkthrough for ChatGPT, ChatGPT Codex, Claude, Gemini, Perplexity, Cursor, GitHub Copilot, OpenAI API, Claude API, and Custom.
- ChatGPT Codex can sync 5h and weekly usage from the existing local Codex CLI login.
- Claude Code can sync 5h and weekly usage from its official local status-line payload after the included setup script is installed.
- Gemini can sync from a local Gemini CLI quota export file when quota bucket data is available.
- Other built-in providers default to manual setup because no consumer subscription quota source is officially supported in this build.
- Manual 5h and weekly setup presets.
- Multiple periods per provider with independent reset routines.
- Reset display formatter using native `Intl.DateTimeFormat`.
- Tooltip settings for selected periods, percentage, remaining amount, next reset, source type, and last updated.
- Manual usage entry per provider and period.
- Local SQLite storage in Tauri desktop mode.
- Browser development fallback through localStorage for non-secret usage/settings only.
- API credential commands routed to OS secure storage in Tauri mode.
- Codex usage sync reads `CODEX_HOME\auth.json` or `%USERPROFILE%\.codex\auth.json` inside the Tauri backend, calls the ChatGPT Codex usage endpoint, and never stores the token in Ai Usage Dock.
- Claude Code sync reads only `%USERPROFILE%\.ai-usage-dock\claude-code-usage.json`, a sanitized file written by the included status-line script.
- Gemini sync reads only `%USERPROFILE%\.ai-usage-dock\gemini-cli-usage.json`, a sanitized quota export file.

## Local Provider Sync Setup

Codex works automatically after `codex login` because Ai Usage Dock reuses the local Codex CLI auth file inside the native backend.

Claude Code requires the official status-line hook:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-claude-statusline.ps1
```

If you already have a Claude Code status line, rerun with `-Force` only if you want Ai Usage Dock to replace it. The script creates a backup of `~\.claude\settings.json`.

Gemini expects a sanitized local quota export. If you have quota bucket JSON from a supported Gemini CLI helper, write it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\write-gemini-cli-quota-export.ps1 -QuotaJsonPath .\gemini-quota.json
```

If Gemini CLI quota data is not available on your machine, keep Gemini in manual setup. Ai Usage Dock will show the Gemini local source as unavailable instead of guessing.

## Commands

```powershell
npm install
npm run dev
npm run build
npm run lint
npm run test
npm run setup:windows
npm run setup:windows:installer
npm run tauri:dev
npm run tauri:build
```

## Windows Setup Script

Run this from the project root to install/check the tools needed to run and build the Tauri app:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

What it handles:

- Node.js LTS through `winget`, if missing.
- Microsoft Edge WebView2 Runtime through `winget`, if missing.
- Rust/rustup through `winget`, if missing.
- Visual Studio 2022 Build Tools with MSVC.
- Latest compatible installed Windows SDK detection for native linking.
- `npm install`.
- `npm run build`, `npm run lint`, and `npm run test`.
- `npm run tauri -- info`.

Optional flags:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipNativeBuildTools
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -NoNpmInstall
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -BuildInstaller
```

The native MSI output will be under `src-tauri\target\release\bundle\msi` after a successful `-BuildInstaller` run.

If `winget` says `rustup` is already installed but PowerShell cannot find `rustup`, `rustc`, or `cargo`, reopen PowerShell or run:

```powershell
$env:Path="$env:USERPROFILE\.cargo\bin;$env:Path"
```

The setup script adds this path automatically for the current run.

## Project Shape

- `src/domain`: active-provider model, multi-period reset logic, formatter, percentage calculation, tray tooltip derivation.
- `src/data`: first-time setup helpers and provider/period defaults.
- `src/adapters`: manual, estimated, unsupported, and placeholder official adapter classes that return unsupported until a real official/local source is implemented.
- `src/security`: credential service abstraction. Browser dev mode never persists API keys.
- `src/notifications`: low-usage notification manager.
- `src-tauri`: native tray shell, local usage sync commands, menu actions, percentage icon rendering, secure credential commands, and hide-to-tray behavior.
