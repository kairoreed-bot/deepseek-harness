#!/usr/bin/env bash
# Boot smoke test for a packaged Linux AppImage.
#
# "It compiled and electron-builder produced a file" is not "it opens a window".
# This starts Xvfb, launches the AppImage, and fails unless a real application
# window with a title appears. Screenshot is kept as an artifact so a human can
# confirm what the window actually looked like.
#
# Usage: linux/smoke-appimage.sh <path-to.AppImage> [outdir]
set -uo pipefail

APPIMAGE="${1:?usage: smoke-appimage.sh <path-to.AppImage> [outdir]}"
OUTDIR="${2:-smoke}"
DISPLAY_NUM=":99"
TIMEOUT_S=90

mkdir -p "$OUTDIR"
export DISPLAY="$DISPLAY_NUM"

cleanup() {
  pkill -x Xvfb 2>/dev/null
  pkill -x openbox 2>/dev/null
}
trap cleanup EXIT

echo "[smoke] starting Xvfb on $DISPLAY_NUM"
Xvfb "$DISPLAY_NUM" -screen 0 1440x900x24 -nolisten tcp >"$OUTDIR/xvfb.log" 2>&1 &
for _ in $(seq 1 20); do
  xdpyinfo >/dev/null 2>&1 && break
  sleep 0.5
done
openbox >"$OUTDIR/openbox.log" 2>&1 &
sleep 1

# AppImages need FUSE; GitHub runners have none, so extract-and-run is the portable path.
echo "[smoke] launching $APPIMAGE"
APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" --no-sandbox --disable-gpu --disable-dev-shm-usage \
  >"$OUTDIR/app.log" 2>&1 &
APP_PID=$!

window_title=""
for _ in $(seq 1 "$TIMEOUT_S"); do
  window_title="$(xdotool search --onlyvisible --name '.' getwindowname %@ 2>/dev/null | grep -v '^$' | head -1)"
  [ -n "$window_title" ] && break
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[smoke] FAIL: process exited before a window appeared"
    tail -40 "$OUTDIR/app.log" || true
    exit 1
  fi
  sleep 1
done

if [ -z "$window_title" ]; then
  echo "[smoke] FAIL: no window after ${TIMEOUT_S}s"
  tail -40 "$OUTDIR/app.log" || true
  exit 1
fi

echo "[smoke] window appeared: $window_title"

# A window that exists is not a window that painted. Give the renderer time to settle, then
# capture the window itself rather than the whole virtual screen, so the artifact is inspectable.
sleep 12
wid="$(xdotool search --onlyvisible --name '.' | head -1)"
geometry="$(xdotool getwindowgeometry "$wid" 2>/dev/null)"
echo "[smoke] geometry: $(echo "$geometry" | tr '\n' ' ')"
ffmpeg -loglevel error -f x11grab -video_size 1440x900 -i "$DISPLAY_NUM" -frames:v 1 -y "$OUTDIR/screen.png" 2>/dev/null || true

x="$(echo "$geometry" | sed -n 's/.*Position: \([0-9]*\),\([0-9]*\).*/\1/p')"
y="$(echo "$geometry" | sed -n 's/.*Position: \([0-9]*\),\([0-9]*\).*/\2/p')"
w="$(echo "$geometry" | sed -n 's/.*Geometry: \([0-9]*\)x\([0-9]*\).*/\1/p')"
h="$(echo "$geometry" | sed -n 's/.*Geometry: \([0-9]*\)x\([0-9]*\).*/\2/p')"
if [ -n "$x" ] && [ -n "$w" ]; then
  ffmpeg -loglevel error -i "$OUTDIR/screen.png" -vf "crop=${w}:${h}:${x}:${y}" -y "$OUTDIR/window.png" 2>/dev/null \
    || cp "$OUTDIR/screen.png" "$OUTDIR/window.png"
else
  cp "$OUTDIR/screen.png" "$OUTDIR/window.png"
fi
echo "[smoke] screenshot: $OUTDIR/window.png"

# A window that appears and dies a couple of seconds later is still broken.
sleep 5
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "[smoke] FAIL: window appeared but the process died within 5s"
  tail -40 "$OUTDIR/app.log" || true
  exit 1
fi

kill "$APP_PID" 2>/dev/null
echo "[smoke] PASS"
