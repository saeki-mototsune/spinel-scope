#!/bin/bash
# Runs the wasm 3-stage pipeline over every sample, then compiles and runs
# the generated C with the host cc (proxy for the server-side execution),
# diffing everything against expected/.
set -uo pipefail
cd "$(dirname "$0")"
ROOT=../..
WASM=$ROOT/web/wasm
SPINEL=$ROOT/toolchain/spinel-src
fail=0

for rb in samples/*.rb; do
  name=$(basename "$rb" .rb)
  exp="expected/$name"
  work=$(mktemp -d)
  cp "$rb" "$work/in.rb"

  node "$ROOT/test/spike/run-tool.mjs" "$WASM/spinel_parse.mjs" "$work" \
    '{"SPINEL_AST_LOCATIONS":"loc.txt"}' in.rb out.ast || { echo "FAIL $name (parse)"; fail=1; continue; }
  node "$ROOT/test/spike/run-tool.mjs" "$WASM/spinel_analyze.mjs" "$work" '{}' out.ast out.ir \
    || { echo "FAIL $name (analyze)"; fail=1; continue; }
  node "$ROOT/test/spike/run-tool.mjs" "$WASM/spinel_codegen.mjs" "$work" '{}' out.ast out.ir out.c \
    || { echo "FAIL $name (codegen)"; fail=1; continue; }
  cc -O2 -Wno-all -I"$SPINEL/lib" "$work/out.c" "$SPINEL/lib/libspinel_rt.a" -lm -o "$work/user_bin" \
    || { echo "FAIL $name (cc)"; fail=1; continue; }
  "$work/user_bin" > "$work/run.txt" || { echo "FAIL $name (run)"; fail=1; continue; }

  ok=1
  for f in out.ast loc.txt loc.txt.src out.ir out.c run.txt; do
    diff -q "$work/$f" "$exp/$f" > /dev/null || { echo "FAIL $name ($f differs)"; ok=0; fail=1; }
  done
  [ $ok -eq 1 ] && echo "PASS $name"
  rm -rf "$work"
done
exit $fail
