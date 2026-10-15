# Vessel

See how much of your AI limits is left, right from the Windows taskbar.

Vessel sits in the tray. Its icon colour shows your lowest limit (green, amber or red). Click it to see each tool's remaining percentage and when it resets.

| Tool | Status |
|---|---|
| Codex | Supported |
| Claude Code | Supported (adds a small status-line hook, with a backup) |
| Gemini | Coming soon. The Gemini app's usage cannot be read automatically |

Everything stays on your PC. See [docs/PRIVACY.md](docs/PRIVACY.md) for exactly what Vessel reads, sends and changes.

> Codex numbers come from an unofficial ChatGPT page that can change or stop working without notice. Vessel shows a "Source changed" badge if that happens.

## Use it

1. Install and start Vessel. A short setup opens on first run.
2. Accept the notice, then press **Connect** next to each tool you use.
3. Click the tray icon any time. Open Settings (the gear) for alerts, quiet hours and refresh interval.

## Develop

Requirements: Node 22+, Rust (stable) and the WebView2 runtime (included in Windows 11).

```powershell
npm install
npm run tauri:dev     # run the app
npm test              # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
npm run tauri:build   # build the installer
```

If PowerShell blocks `npm`, run it through `cmd /c npm ...`.

See [docs/RELEASING.md](docs/RELEASING.md) for releases, code signing and auto-update.

## How it is built

- `src-tauri/` is a Rust backend (Tauri 2). Each provider lives in `src-tauri/src/providers/`. A scheduler refreshes in the background, a store keeps the last numbers, and alerts are decided in `alerts.rs`.
- `src/` is a React + TypeScript + Tailwind UI: the tray popup, first-run setup and the settings window.
- The UI never touches your tokens or files. It only calls Rust commands.
