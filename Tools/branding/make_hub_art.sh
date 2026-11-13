#!/bin/bash
# Renders the Hub panel picture (Resources/branding/hub-art.png, 1320x840) with the Piston runtime, in headless Chrome.
# Needs Google Chrome and python3. Run from anywhere:  Tools/branding/make_hub_art.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=8765
python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 50); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/Tools/branding/hub-art/index.html" && break; sleep 0.2; done
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=660,420 \
  --virtual-time-budget=10000 --screenshot="$PWD/Resources/branding/hub-art.png" "http://127.0.0.1:$PORT/Tools/branding/hub-art/index.html" 2>&1 | grep -v -i "dbus\|gpu\|skia" || true
ls -l Resources/branding/hub-art.png
