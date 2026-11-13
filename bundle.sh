#!/bin/bash
# Builds Piston.app (ad-hoc signed, local only). The engine, bridge, project template and samples ship INSIDE
# the app; a game project never contains them.
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
APP=Piston.app
RES="$APP/Contents/Resources"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES"
cp .build/release/Piston "$APP/Contents/MacOS/Piston"
mkdir -p "$RES/Engine" "$RES/Bridge"
cp -R Engine/web "$RES/Engine/web"
cp -R Bridge/web "$RES/Bridge/web"
cp -R Templates "$RES/Templates"
cp -R EditorDocs "$RES/EditorDocs"
cp -R EditorWeb "$RES/EditorWeb"
cp -R Plugins "$RES/Plugins"
cp -R Samples "$RES/Samples"
cp Resources/Piston.icns "$RES/Piston.icns"
# Release-build tools (esbuild binary + obfuscator). The binary must stay executable and signed.
cp -R Toolchain "$RES/Toolchain"
chmod +x "$RES/Toolchain/esbuild"
codesign --force --sign - "$RES/Toolchain/esbuild" 2>/dev/null || true
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Piston</string>
  <key>CFBundleDisplayName</key><string>Piston</string>
  <key>CFBundleIdentifier</key><string>com.jurikiin.Piston</string>
  <key>CFBundleExecutable</key><string>Piston</string>
  <key>CFBundleIconFile</key><string>Piston</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <!-- The embedded web runtime is served from 127.0.0.1 over plain HTTP. -->
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
xattr -cr "$APP" 2>/dev/null || true
codesign --force --sign - "$APP"
echo "Built $(pwd)/$APP"
