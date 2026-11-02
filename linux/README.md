# Linux desktop builds (fork)

Unofficial Linux x64 desktop builds of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
Upstream ships Windows and macOS desktop packages only; this fork adds a Linux target and publishes
AppImage, tar.gz, deb and rpm from GitHub Releases.

The AppImage self-updates: electron-updater reads `latest-linux.yml` from the newest release.

## What this fork changes

Everything is marked `LINUX-PATCH` in the source so a conflicting upstream hunk is obvious.
`grep -rn LINUX-PATCH` lists the whole delta.

- `apps/desktop/scripts/desktop-build-paths.mjs` + `.d.mts`: allow the `linux-x64` target name and report `platform: 'linux'` for it.
- `apps/desktop/scripts/package-target.ts`: `linux-x64` in the type union and `TARGETS`, a Linux build-host guard, and a signing-free `linux-package` stage.
- `apps/desktop/scripts/desktop-package-environment.mjs` + `.d.mts`: read `.env.linux`, accept the `DSH_DESKTOP_LINUX_*` settings namespace, validate Linux settings, and skip the mandatory-update policy for unsigned Linux builds (mirrors unsigned macOS).
- `apps/desktop/scripts/desktop-auto-update-environment.mjs` + `.d.mts`: allow `linux-x64` and emit `latest-linux.yml` as the metadata filename.
- `apps/desktop/scripts/desktop-toolchain-preflight.ts`: accept `platform: 'linux'`.
- `apps/desktop/scripts/prepare-runtime.ts`, `prepare-dsh.ts`: the Electron executable is plain `electron` on Linux, not a macOS `.app` bundle. This is the one hard breakage; both files used to assume "not Windows means macOS".
- `apps/desktop/scripts/electron-builder-config.mjs`: real Linux targets (`AppImage`, `tar.gz`, `deb`, `rpm`), an icon, deb/rpm metadata, and an opt-in GitHub Releases update feed.
- `apps/desktop/scripts/linux-package-settings.mjs`: new file, Linux pack concurrency and compression.
- `apps/desktop/.env.linux` / `.env.linux.example`: Linux packaging settings (no secrets).
- both `package.json` files: `package:linux:x64`, `:unsigned`, `:dir`, and root-level `package:desktop:linux:*` wrappers.

Windows and macOS behaviour is untouched: every change is either an added union member, an added
branch that only matches `platform === 'linux'`, or a new file.

## Build locally

```bash
pnpm install --frozen-lockfile
pnpm run package:desktop:linux:x64:unsigned
```

Artifacts land in `apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/`.

```bash
# collect with clean release names + write the updater feed
bash linux/collect-artifacts.sh \
  apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts dist-linux "$(node -p "require('./apps/desktop/package.json').version")"

# boot test: starts Xvfb, launches the AppImage, fails unless a real window appears
bash linux/smoke-appimage.sh dist-linux/deepseek-harness-*-linux-x64.AppImage smoke
```

`smoke-appimage.sh` sets `APPIMAGE_EXTRACT_AND_RUN=1` because GitHub runners have no FUSE.

## Why not repackage the Windows/macOS builds

`ilysenko/codex-desktop-linux` did exactly that and retired the approach (`Historical macOS DMG
conversion ... intentionally not active documentation` in their README). Repackaging a signed binary
you cannot rebuild means every upstream release can silently break your patch set, and Windows to
Linux is worse than macOS to Linux (PE/NSIS installer, signtool, win32 native modules). Adding the
packaging target is a five-file diff against a codebase that already has Linux branches in the
application source.

## Automation

`.github/workflows/linux-sync-build.yml`, every 6 hours:

1. merge `deepseek-ai/deepseek-harness` `master` into `linux`
2. clean merge: build, smoke test, publish a release when the desktop package version is new
3. conflict: abort the merge, open or update a `sync-conflict` issue, change nothing

Sync, build and release live in one workflow on purpose: a push made with the default
`GITHUB_TOKEN` does not trigger other workflows, so chaining them would silently do nothing.

Conflicts are never auto-resolved. A wrong auto-merge produces an image that builds and ships broken.

## Known limits

- **Wayland is untested.** No CI can cover it. Each release is worth a manual click-around on a real session.
- x64 only. No arm64 target yet (the native packages for `linux-arm64` do exist upstream).
- No tray icon: upstream's tray is Windows-only (`src/main.ts`), so Linux builds have no tray.
- Builds are unsigned. AppImage, deb and rpm carry no signature by design.
