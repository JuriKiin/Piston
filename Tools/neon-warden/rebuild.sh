#!/bin/bash
# Rebuilds the Neon Warden web build with this checkout's Piston.app. The dev server serves dist/web from disk, so just reload the page.
set -e
cd "$(dirname "$0")/../.."
./Piston.app/Contents/MacOS/Piston --build Samples/NeonWarden 2>&1 | tail -3
