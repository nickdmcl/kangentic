# Deployment

This document covers the full deployment pipeline for maintainers and the update experience for users.

## For Users

### Install

```bash
npx kangentic
```

This downloads the pre-built binary for your platform, installs it, and launches the app. After the first run, auto-updates handle everything (Windows and macOS).

### Auto-Update Behavior

| Platform | Update mechanism | User action |
|----------|-----------------|-------------|
| Windows | Squirrel auto-updater | None. Downloads in background, installs on next restart. |
| macOS | `autoUpdater` via `update-electron-app` | Click "Restart to update" when prompted. Requires code signing -- see [macOS signing note](#macos-auto-update-requires-signing). |
| Linux | None | Re-run `npx kangentic` or download from [GitHub Releases](https://github.com/Kangentic/kangentic/releases). |

The app checks for updates hourly via `update-electron-app` (configured in `src/main/index.ts`), looking at published GitHub Releases.

### Install a Specific Version

```bash
npx kangentic@0.2.0
```

The launcher version matches the app version. This downloads the exact matching release.

### Rollback

To roll back to a previous version, run `npx kangentic@X.Y.Z` with the desired version. On Windows, the Squirrel installer will replace the current version. On macOS, the .app is replaced in `~/Applications/`.

## For Maintainers

### Release Sequencing

1. **`/deploy patch`** (or `minor`/`major`) -- bumps version in root `package.json` + `packages/launcher/package.json`, generates changelog, commits, tags, pushes.
2. **Tag push triggers `release.yml`** -- builds all platforms (Linux x64, Windows x64, macOS arm64, macOS x64), signs binaries (when signing secrets are configured), creates a **draft** GitHub Release with artifacts attached.
3. **Review and publish the draft release** at [github.com/Kangentic/kangentic/releases](https://github.com/Kangentic/kangentic/releases). Publishing is a manual gate.
4. **Publishing triggers `npm-publish.yml`** -- publishes the launcher package to npm.
5. **`npx kangentic`** now downloads the new version's signed binaries.

### Code Signing Secrets

Signing only activates when the corresponding env vars are present. Local dev builds remain unsigned. CI builds sign when secrets exist.

| Secret | Source |
|--------|--------|
| `APPLE_IDENTITY` | Apple Developer ID Application certificate name |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password (not account password) |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_CLIENT_ID` | App registration (service principal) client ID |
| `AZURE_CLIENT_SECRET` | App registration client secret |
| `AZURE_SIGNING_ENDPOINT` | Regional endpoint (e.g., `https://eus.codesigning.azure.net/`) |
| `AZURE_SIGNING_ACCOUNT` | Trusted Signing account name |
| `AZURE_CERT_PROFILE` | Certificate profile name |
| `NPM_TOKEN` | npm access token for publishing launcher |

### macOS Auto-Update Requires Signing

Electron's `autoUpdater` on macOS only works with signed apps (Electron docs: "mandatory for auto-update on macOS"). Until the Apple Developer certificate secrets are configured:

- macOS users will NOT receive auto-updates
- They must re-run `npx kangentic` manually to get new versions
- The Gatekeeper bypass is also required on each install (see [Installation Guide](installation.md#macos-gatekeeper))

### Draft Releases Are Invisible to Auto-Updater

`update-electron-app` only sees **published** releases. Draft releases are invisible to the auto-updater and to `npx kangentic`. The manual publish step is the review gate -- always verify artifacts before publishing.

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build.yml` | Push to main, PRs | Build validation on all platforms |
| `release.yml` | Tag push (`v*`) | Build + sign + create draft GitHub Release |
| `npm-publish.yml` | Release published | Publish launcher to npm |

### CI Build Matrix

The release workflow produces 4 builds:

| Runner | Platform | Artifacts |
|--------|----------|-----------|
| `ubuntu-latest` | linux-x64 | `.deb`, `.rpm` |
| `windows-latest` | windows-x64 | `Setup.exe`, `.nupkg` |
| `macos-latest` | macos-arm64 | `.dmg`, `.zip` |
| `macos-13` | macos-x64 | `.dmg`, `.zip` |

Linux arm64 is not built in v1. Documented in the [Installation Guide](installation.md).

### Local Testing

Test the packaged app locally before releasing:

| Command | What it does |
|---------|-------------|
| `npm run make` | Creates platform installers in `out/make/` |
| `npm run publish -- --dry-run` | Builds installers + simulates publishing (no upload) |
| `npm run publish -- --from-dry-run` | Uploads previously dry-run artifacts |

The installed app and `npm run dev` share the same data directory. Set `KANGENTIC_DATA_DIR` to isolate them if needed.

## Troubleshooting

### Update not appearing

- Verify the release is **published** (not draft) on GitHub
- The app checks hourly -- restart the app to trigger an immediate check
- On macOS, auto-update requires code signing. Without it, updates won't be detected.

### Rollback

Run `npx kangentic@X.Y.Z` with the desired version to download and install that specific release.

### Clearing update cache

- **Windows:** Delete `%LOCALAPPDATA%\Kangentic\packages\` and restart
- **macOS:** Delete `~/Library/Caches/Kangentic/` and restart
