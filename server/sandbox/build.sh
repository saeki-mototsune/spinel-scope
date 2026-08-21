#!/bin/bash
# Builds the local spinel-sandbox image from the repo-root Dockerfile's
# sandbox target. (The VPS gets the same target via .kamal/hooks/pre-deploy.)
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -d toolchain/spinel-src/lib ] || { echo "error: toolchain/spinel-src not found (run Plan 1 toolchain setup)"; exit 1; }
docker build --target sandbox -t spinel-sandbox .
