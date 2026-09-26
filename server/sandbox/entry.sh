#!/bin/sh
# Reads a C program on stdin, compiles and runs it, and emits
# length-prefixed sections so the caller can split streams safely.
# build.env (SP_CFLAGS / SP_LIBS) is spinel's own --print-build for this
# runtime, recorded when the image was built.
. /opt/spinel/build.env
cat > /work/user.c
# shellcheck disable=SC2086
cc -O2 -Wno-all $SP_CFLAGS /work/user.c $SP_LIBS -o /work/prog 2>/work/cc.err
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
