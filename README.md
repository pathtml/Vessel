# Ai Usage Dock

Ai Usage Dock is a small Windows tray app for tracking remaining usage across AI tools such as ChatGPT Codex, Claude, Gemini, Perplexity, Cursor, GitHub Copilot, and custom providers.

Current version: `0.1.1`

## What It Does

- Shows one active provider in the Windows system tray.
- Displays remaining usage as a colored tray icon.
- Opens a compact dashboard from the tray.
- Tracks `5h`, daily, weekly, monthly, and custom reset windows.
- Supports manual usage tracking for providers without supported quota data.
- Supports local sync for selected tools when a supported local source exists.
- Sends optional low-usage notifications.
- Stores usage data locally.

## Privacy And Safety

Ai Usage Dock is intentionally local-first.

It does not:

- Scrape provider websites.
- Read browser cookies.
- Ask for ChatGPT, Claude, Gemini, or other account passwords.
- Automate web login.
- Send your local usage data to a cloud backend.
- Pretend manual or estimated data is official.

If a provider does not expose official or supported local usage data, the app falls back to manual setup.

## Usage Sources

The app labels every provider period by source:

- `Local`: synced from a supported local app/session/export.
- `Manual`: entered and maintained by you.
- `Estimated`: calculated from activity the app can see.
- `Official`: reserved for documented provider APIs.
- `Unsupported`: no supported source is configured.

In `0.1.1`, consumer subscription usage is mostly local or manual. This is deliberate: the app avoids unsafe scraping and credential collection.

## Supported Provider Status

| Provider | Status in 0.1.1 | Notes |
| --- | --- | --- |
| ChatGPT Codex | Local sync | Uses your existing Codex CLI login from `CODEX_HOME\auth.json` or `%USERPROFILE%\.codex\auth.json`. |
| Claude Code | Local sync after setup | Uses Claude Code's official status-line payload and writes a sanitized local export. |
| Gemini | Local export reader | Reads a sanitized Gemini quota export when available. Manual setup is recommended if quota data is unavailable. |
| ChatGPT web | Manual | Consumer web quota is not exposed through a supported public API in this build. |
| Perplexity | Manual | No supported consumer quota source is configured. |
| Cursor | Manual | No supported consumer quota source is configured. |
| GitHub Copilot | Manual | No supported consumer quota source is configured. |
| OpenAI API | Manual | API usage is not the same as ChatGPT/Codex subscription quota. |
| Claude API | Manual | Admin usage APIs are not the same as Claude Pro/Max subscription quota. |
| Custom | Manual | User-defined provider and limits. |

## Install

Download the Windows MSI from the release page:

```text
Ai Usage Dock_0.1.1_x64_en-US.msi
```

Run the installer and launch Ai Usage Dock from the Start Menu or installed app location.

Early public builds may show a Windows SmartScreen or unknown publisher warning if the installer is not code-signed yet.

## First Run

1. Open Ai Usage Dock.
2. Choose a provider.
3. Select the period you want in the tray, usually `5h`.
4. Enter limits manually, or use a local sync provider.
5. Keep the app running in the tray.

Tray menu actions:

- Open Dashboard
- Add manual usage
- Reset Current Period
- Settings
- Quit

## Local Sync Setup

### ChatGPT Codex

Codex sync works after you have signed in with the Codex CLI.

Ai Usage Dock reads:

```text
CODEX_HOME\auth.json
%USERPROFILE%\.codex\auth.json
```

The token is read by the native Tauri backend only. Ai Usage Dock does not store a copy of it.

### Claude Code

Claude Code sync requires the included status-line setup script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-claude-statusline.ps1
```

The script installs a Claude Code status-line command that writes sanitized rate-limit data to:

```text
%USERPROFILE%\.ai-usage-dock\claude-code-usage.json
```

If you already have a Claude Code status line, rerun with `-Force` only if you want to replace it. The script creates a backup of `~\.claude\settings.json`.

Claude Code only includes rate-limit data for supported Claude.ai subscriber sessions and usually only after a Claude Code API response has occurred.

### Gemini

Gemini sync reads a sanitized local export:

```text
%USERPROFILE%\.ai-usage-dock\gemini-cli-usage.json
```

If you have quota bucket JSON from a supported Gemini CLI helper, write the export with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\write-gemini-cli-quota-export.ps1 -QuotaJsonPath .\gemini-quota.json
```

If that quota data is not available, keep Gemini as manual. The app will not guess.

## Build From Source

Contributor workflow is documented in [CONTRIBUTING.md](CONTRIBUTING.md).

Requirements:

- Windows 10 or 11
- Node.js LTS
- Rust with MSVC target
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools with MSVC and a compatible Windows SDK

Install/check the Windows build tools:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Common development commands:

```powershell
npm install
npm run dev
npm run lint
npm run test
npm run build
npm run tauri:dev
npm run tauri:build
```

Build the installer:

```powershell
npm run tauri:build
```

The MSI output is written to:

```text
src-tauri\target\release\bundle\msi
```

The setup helper can also build the installer:

```powershell
npm run setup:windows:installer
```

## Release Checklist

For a public release:

1. Bump versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run validation:

```powershell
npm run lint
npm run test
npm run build
cargo check --manifest-path .\src-tauri\Cargo.toml
npm run tauri:build
```

3. Create a Git tag, for example `v0.1.1`.
4. Upload the MSI to GitHub Releases.
5. Publish a SHA256 checksum:

```powershell
Get-FileHash ".\src-tauri\target\release\bundle\msi\Ai Usage Dock_0.1.1_x64_en-US.msi" -Algorithm SHA256
```

6. Code-sign the installer when possible.

## Project Structure

- `src/App.tsx`: dashboard, setup flow, local sync UI, modals, and tray-facing state.
- `src/domain`: provider model, reset logic, usage calculations, tray tooltip logic, and tests.
- `src/data`: provider defaults and first-time setup helpers.
- `src/adapters`: manual, estimated, unsupported, and placeholder official adapter classes.
- `src/security`: credential helper abstraction.
- `src/storage`: SQLite storage in Tauri mode and localStorage fallback in browser dev mode.
- `src/notifications`: low-usage notification logic.
- `src-tauri`: native tray app, secure credential commands, local usage sync commands, and installer config.
- `scripts`: Windows setup, Claude Code status-line setup, and Gemini export helpers.

## Known Limitations

- Most consumer AI products do not expose official remaining-quota APIs.
- Gemini support depends on an available local quota export.
- Claude support depends on Claude Code status-line rate-limit data being present.
- Unsigned public installers can trigger Windows reputation warnings.
- The app currently tracks one active tray provider at a time.

## License

Ai Usage Dock is released under the MIT License. See [LICENSE](LICENSE).
