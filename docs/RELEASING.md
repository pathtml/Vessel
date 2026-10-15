# Releasing Vessel

## Build the installer locally

```powershell
npm ci
npm run tauri:build
```

The installer appears in `src-tauri/target/release/bundle/nsis/`.

## Publish a release

1. Update the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, then push a tag such as `v0.1.0`.
3. The **Release** workflow builds the installer and attaches it to a draft GitHub Release. Review it, then publish.

## Code signing (optional, not set up yet)

Without a code-signing certificate the installer still works, but Windows SmartScreen shows an "unknown publisher" warning. To remove it you need a Windows code-signing certificate from a certificate authority, then add its details to the Tauri bundle config (`bundle.windows.certificateThumbprint` or a signing command) and the matching GitHub secrets.

## Auto-update (not wired yet)

Auto-update needs three things that must come from the project owner, so it is intentionally not half-configured:

1. A minisign key pair: `npx tauri signer generate -w ~/.tauri/vessel.key`. Keep the private key and password secret. Add them as the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets.
2. A public place to host the update manifest (for example the GitHub Release `latest.json`).
3. The `tauri-plugin-updater` plugin, with the public key and manifest URL in `tauri.conf.json`, plus a "Check for updates" row in Settings.

Once the key exists, wiring the plugin is a small change.
