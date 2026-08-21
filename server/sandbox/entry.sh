#!/bin/sh
# Reads a C program on stdin, compiles and runs it, and emits
# length-prefixed sections so the caller can split streams safely.
cat > /work/user.c
cc -O2 -Wno-all -I/opt/spinel/lib /work/user.c /opt/spinel/lib/libspinel_rt.a -lm -o /work/prog 2>/work/cc.err
CCEXIT=$?
RUNEXIT=-1
: > /work/out
: > /work/err
if [ "$CCEXIT" -eq 0 ]; then
  timeout 10 /work/prog > /work/out 2> /work/err
  RUNEXIT=$?
fi
for f in cc.err out err; do
  printf 'SECTION %s %s\n' "$f" "$(wc -c < /work/$f)"
  cat "/work/$f"
done
printf 'EXIT %s %s\n' "$CCEXIT" "$RUNEXIT"
