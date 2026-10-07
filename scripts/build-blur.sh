#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Window background blur addon, built against this Electron's headers.
ELECTRON_VERSION=$(node -p "require('electron/package.json').version")
(cd native/blur && ../../node_modules/.bin/node-gyp rebuild --target="$ELECTRON_VERSION" --arch=arm64 --dist-url=https://electronjs.org/headers >/dev/null)
