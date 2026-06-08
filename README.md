# LLM Usage Tray

A local Windows tray app MVP for tracking remaining usage limits across LLM tools such as ChatGPT, Claude, Gemini, Perplexity, Cursor, and Codex.

## What Works Now

- React dashboard with provider cards.
- Manual and estimated usage labels.
- Daily, weekly, monthly, and custom-hour reset rules.
- Remaining quota percentages and status colors.
- Add/edit provider modal.
- Add usage modal and quick `+1` / `+10` actions.
- Reset provider action.
- Low-remaining notifications with cooldowns.
- Local storage:
  - Tauri desktop mode uses SQLite through `@tauri-apps/plugin-sql`.
  - Browser/Vite development falls back to `localStorage`.
- Tauri tray shell:
  - Open dashboard.
  - Add usage.
  - Reset first provider.
  - Settings.
  - Quit.

## Important Limitations

Most consumer LLM apps do not expose official remaining-quota APIs. This app does not scrape browser sessions, collect passwords, or read cookies. Values are labeled as:

- `Manual`: user-maintained local values.
- `Estimated`: local estimates based on configured quotas.
- `Official`: reserved for future official API integrations.

## Commands

```powershell
npm install
npm run dev
npm run build
npm run lint
npm run tauri:dev
npm run tauri:build
```

## Native Build Requirements

The current machine has Node and WebView2, but Tauri reports missing native build prerequisites:

- Rust / Cargo / rustup
- Visual Studio Build Tools with MSVC and Windows SDK components

Install those before running `npm run tauri:dev` or `npm run tauri:build`.

## Project Shape

- `src/domain`: data model, reset logic, usage summaries.
- `src/storage`: SQLite/localStorage storage drivers.
- `src/adapters`: provider adapter interface and MVP adapters.
- `src/notifications`: low-usage notification manager.
- `src-tauri`: native Tauri tray app shell.
