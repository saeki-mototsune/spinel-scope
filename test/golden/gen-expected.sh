#!/bin/bash
# Generates golden expectations by running the PATCHED native spinel pipeline.
set -euo pipefail
cd "$(dirname "$0")"
SPINEL=../../toolchain/spinel-src

for rb in samples/*.rb; do
  name=$(basename "$rb" .rb)
  dir="expected/$name"
  mkdir -p "$dir"
  SPINEL_AST_LOCATIONS="$dir/loc.txt" "$SPINEL/spinel_parse" "$rb" "$dir/out.ast"
  "$SPINEL/spinel_analyze" "$dir/out.ast" "$dir/out.ir"
  "$SPINEL/spinel_codegen" "$dir/out.ast" "$dir/out.ir" "$dir/out.c"
  cc -O2 -Wno-all -I"$SPINEL/lib" "$dir/out.c" "$SPINEL/lib/libspinel_rt.a" -lm -o "/tmp/golden-$name"
  "/tmp/golden-$name" > "$dir/run.txt"
  echo "OK $name"
done
