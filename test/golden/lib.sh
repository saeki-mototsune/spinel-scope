# Shared by gen-expected.sh and run.sh. Sourced from test/golden/.
ROOT=$(cd ../.. && pwd)
SPINEL=$ROOT/toolchain/spinel-src/bin/spinel

# The builtins/*.rb spinel splices in are named by where the compiler found
# them: <tree>/bin/../builtins/ natively, /spinel/builtins/ in the wasm
# module. Everything else in the artifacts is path-independent.
normalize() { sed -E 's#[^" ]*/builtins/#<builtins>/#g'; }

# The native side of one visualization: the same two runs the Worker makes
# (web/js/spinel-runner.js), in a directory holding main.rb.
native_artifacts() {
  (cd "$1" \
    && SPINEL_EMIT_TYPES=1 "$SPINEL" main.rb --dump-ast > out.ast \
    && SPINEL_PROFILE_SYMBOL_MAP=symbols.json "$SPINEL" main.rb --emit-types -o types.json -S > out.c 2> /dev/null)
}

# Compiles and runs a generated C file the way the sandbox does
# (server/sandbox/entry.sh): -O2 plus spinel's own --print-build flags.
build_and_run() {
  local c=$1 bin=$2
  eval "$("$ROOT/server/sandbox/print-build-env.sh" "$SPINEL")"
  # shellcheck disable=SC2086
  cc -O2 -Wno-all $SP_CFLAGS "$c" $SP_LIBS -o "$bin" && "$bin"
}
