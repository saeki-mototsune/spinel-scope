#!/bin/bash
# Runs the wasm spinel over every sample the way the Worker does
# (run-wasm.mjs), then compiles and runs the generated C with the host cc
# (proxy for the server-side execution), diffing everything against
# expected/.
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh
fail=0

for rb in samples/*.rb; do
  name=$(basename "$rb" .rb)
  exp="expected/$name"
  work=$(mktemp -d)

  node run-wasm.mjs "$ROOT/web/wasm/spinel.mjs" "$rb" "$work" \
    || { echo "FAIL $name (wasm spinel)"; fail=1; continue; }
  build_and_run "$work/out.c" "$work/prog" > "$work/run.txt" \
    || { echo "FAIL $name (cc/run)"; fail=1; continue; }

  ok=1
  for f in out.ast types.json symbols.json out.c run.txt; do
    normalize < "$work/$f" | diff -q - "$exp/$f" > /dev/null \
      || { echo "FAIL $name ($f differs)"; ok=0; fail=1; }
  done
  [ $ok -eq 1 ] && echo "PASS $name"
  rm -rf "$work"
done
exit $fail
