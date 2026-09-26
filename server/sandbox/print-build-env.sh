#!/bin/sh
# Turns `spinel --print-build` (the build ingredients spinel is authoritative
# about) into the sh variables a generated program is compiled with:
#   SP_CFLAGS  cflag / define / include (as -I)
#   SP_LIBS    runtime archive / libs
# Used by the Dockerfile (-> /opt/spinel/build.env, sourced by entry.sh) and
# by test/golden/run.sh, so both compile the C the way spinel itself would.
# usage: print-build-env.sh <path/to/spinel>
set -eu
"$1" -e 'puts 1' --print-build | sed 's#/bin/\.\./#/#g' | awk '
  $1 == "cflag" || $1 == "define" { c = c " " $2 }
  $1 == "include"                 { c = c " -I" $2 }
  $1 == "runtime" || $1 == "lib"  { l = l " " $2 }
  END { printf "SP_CFLAGS=\"%s\"\nSP_LIBS=\"%s\"\n", substr(c, 2), substr(l, 2) }'
