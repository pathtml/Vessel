# Contributing To Ai Usage Dock

Thanks for helping improve Ai Usage Dock. The project is intentionally conservative: it should help users track AI usage without scraping websites, collecting passwords, or pretending unsupported data is exact.

## Ground Rules

- Keep all user data local unless a future feature clearly explains otherwise.
- Do not add browser-cookie reading, password collection, hidden scraping, or automated login flows.
- Label usage data honestly as `Local`, `Manual`, `Estimated`, `Official`, or `Unsupported`.
- Prefer supported local sources and documented official APIs.
- Keep the Windows tray experience lightweight.

## Development Setup

Requirements:

- Windows 10 or 11
- Node.js LTS
- Rust with the MSVC toolchain
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools with MSVC and Windows SDK

Install/check local tooling:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Install dependencies:

```powershell
npm install
```

Run the app in development:

```powershell
npm run tauri:dev
```

Browser-only development is also available:

```powershell
npm run dev
```

Browser mode uses localStorage fallback and does not exercise native tray, SQLite, credential, or local sync commands.

## Validation

Before opening a pull request, run:

```powershell
npm run lint
npm run test
npm run build
cargo check --manifest-path .\src-tauri\Cargo.toml
```

For installer or native tray changes, also run:

```powershell
npm run tauri:build
```

## Provider Integrations

Provider integrations must follow these rules:

- Use a documented official API, a supported local app mechanism, or user-provided manual data.
- Do not collect account passwords.
- Do not extract browser cookies or session storage.
- Do not scrape private web dashboards.
- Do not mark a source as `Official` unless the provider documents it as official.
- If sync fails, keep the last known value and mark the provider as stale or unavailable.

Examples:

- Good: reading Codex CLI auth from the user's local Codex login inside the native backend.
- Good: reading Claude Code's official status-line payload from a sanitized local export.
- Good: manual quota setup with clear reset rules.
- Not allowed: reading Chrome cookies to call private web endpoints.

## Code Style

- Use TypeScript for frontend/domain code.
- Keep provider calculations in `src/domain` when possible.
- Keep native OS integration in `src-tauri`.
- Keep scripts Windows PowerShell friendly.
- Avoid broad refactors in small fixes.
- Add focused tests for usage math, reset logic, and provider defaults.

## Commit Style

Use Conventional Commits:

```text
feat: add provider setup flow
fix: handle missing local quota export
docs: update release instructions
chore(release): 0.1.1
```

## Pull Request Checklist

- The change follows the privacy and provider integration rules.
- Lint, tests, and build pass.
- Native changes were checked with `cargo check`.
- Installer changes were checked with `npm run tauri:build`.
- README or setup docs were updated when user-facing behavior changed.
- New provider data is labeled honestly.

## Security Reports

Please do not open a public issue for sensitive security problems. If this project later adds a security contact, report vulnerabilities there. Until then, keep security fixes minimal, clear, and private until patched.
