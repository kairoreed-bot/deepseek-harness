#!/usr/bin/env bash
# Collect the packaged Linux artifacts into a flat directory with clean release names.
#
# The upstream scripts tag unsigned builds with a `-unsigned` suffix so a local artifact can never
# pass for a signed release. These Linux artifacts are unsigned by design (AppImage/deb/rpm carry no
# signature), so the suffix is stripped at publish time and electron-updater's feed file is written
# against the clean names.
#
# Usage: linux/collect-artifacts.sh <source-dir> <out-dir> <version>
set -euo pipefail

SRC="${1:?usage: collect-artifacts.sh <source-dir> <out-dir> <version>}"
OUT="${2:?}"
VERSION="${3:?}"

mkdir -p "$OUT"
rm -f "$OUT"/*.AppImage "$OUT"/*.tar.gz "$OUT"/*.deb "$OUT"/*.rpm "$OUT"/latest-linux.yml 2>/dev/null || true

found_appimage=""
for src in "$SRC"/*-unsigned.* "$SRC"/*.AppImage "$SRC"/*.tar.gz "$SRC"/*.deb "$SRC"/*.rpm; do
  [ -e "$src" ] || continue
  base="$(basename "$src")"
  case "$base" in
    *.AppImage) ext="AppImage" ;;
    *.tar.gz)   ext="tar.gz" ;;
    *.deb)      ext="deb" ;;
    *.rpm)      ext="rpm" ;;
    *) continue ;;
  esac
  dest="$OUT/deepseek-harness-${VERSION}-linux-x64.${ext}"
  cp -f "$src" "$dest"
  echo "collected $base -> $(basename "$dest")"
  [ "$ext" = "AppImage" ] && found_appimage="$(basename "$dest")"
done

if [ -z "$found_appimage" ]; then
  echo "collect-artifacts: no AppImage found in $SRC" >&2
  exit 1
fi

node "$(dirname "$0")/gen-latest-linux-yml.mjs" "$OUT" "$VERSION" "$found_appimage"
ls -la "$OUT"
