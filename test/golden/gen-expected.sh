#!/bin/bash
# Generates golden expectations with the PATCHED native spinel
# (make -C toolchain native): per sample, the text AST, the types JSON, the
# symbol map and the C of one compile, plus the program's output.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

for rb in samples/*.rb; do
  name=$(basename "$rb" .rb)
  dir="expected/$name"
  work=$(mktemp -d)
  cp "$rb" "$work/main.rb"
  native_artifacts "$work"
  rm -rf "$dir"
  mkdir -p "$dir"
  for f in out.ast types.json symbols.json out.c; do
    normalize < "$work/$f" > "$dir/$f"
  done
  build_and_run "$work/out.c" "$work/prog" > "$dir/run.txt"
  rm -rf "$work"
  echo "OK $name"
done
