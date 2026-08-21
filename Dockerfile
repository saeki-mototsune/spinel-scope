# syntax=docker/dockerfile:1
# 4 stages: bootstrap → wasm → sandbox → app.
# `app` is LAST so a target-less `docker build .` (= what Kamal runs)
# produces the app image. The sandbox image is built with --target sandbox
# (server/sandbox/build.sh locally, .kamal/hooks/pre-deploy for the VPS).

# ---- Stage 1: spinel native bootstrap -------------------------------------
# Generates build/analyze1.c / build/codegen1.c, which the WASM stage
# compiles with emscripten. `make clean` first: the build context carries
# host-built (macOS) binaries whose timestamps would otherwise let make
# skip the rebuild — or worse, exec them.
FROM ruby:4.0 AS bootstrap
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /spinel
COPY toolchain/spinel-src/ ./
RUN NO_CCACHE=1 make clean && NO_CCACHE=1 make \
    && test -s build/analyze1.c && test -s build/codegen1.c

# ---- Stage 2: WASM artifacts via emscripten --------------------------------
FROM emscripten/emsdk:4.0.6 AS wasm
WORKDIR /build
COPY toolchain/Makefile toolchain/Makefile
COPY toolchain/spinel-src/ toolchain/spinel-src/
COPY --from=bootstrap /spinel/build/analyze1.c toolchain/spinel-src/build/analyze1.c
COPY --from=bootstrap /spinel/build/codegen1.c toolchain/spinel-src/build/codegen1.c
# EMCC=emcc: the emsdk image puts emcc on PATH (no emsdk checkout at the
# path the Makefile defaults to). OUT resolves to /build/web/wasm.
RUN make -C toolchain EMCC=emcc

# ---- Stage 3: sandbox (compiles+runs user C, one throwaway container/run) --
# Port of the former server/sandbox/Dockerfile; lib now comes straight from
# the build context instead of build.sh's mktemp staging.
FROM debian:12-slim AS sandbox
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*
COPY toolchain/spinel-src/lib/ /opt/spinel/lib/
RUN cd /opt/spinel/lib \
  && cc -c -O2 -Wno-all -Iregexp regexp/re_compile.c -o re_compile.o \
  && cc -c -O2 -Wno-all -Iregexp regexp/re_exec.c -o re_exec.o \
  && cc -c -O2 -Wno-all -Iregexp regexp/re_utf8.c -o re_utf8.o \
  && cc -c -O2 -Wno-all -I. sp_bigint.c -o sp_bigint.o \
  && ar rcs libspinel_rt.a re_compile.o re_exec.o re_utf8.o sp_bigint.o \
  && rm -f *.o
COPY server/sandbox/entry.sh /entry.sh
RUN chmod 755 /entry.sh && chmod -R a+rX /opt/spinel
# GCC needs a writable scratch dir; the rootfs (incl. /tmp) is read-only at
# run time, only /work is writable.
ENV TMPDIR=/work
ENTRYPOINT ["/entry.sh"]

# ---- Stage 4 (default): app server ------------------------------------------
FROM ruby:4.0-slim AS app
# build-essential: puma's native extension. docker CLI: static binary from
# the official cli image — the daemon is the host's, via the mounted socket.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
ENV RACK_ENV=production BUNDLE_DEPLOYMENT=1 BUNDLE_WITHOUT=test
WORKDIR /app/server
COPY server/Gemfile server/Gemfile.lock ./
RUN bundle install
COPY server/ ./
COPY web/ /app/web/
COPY --from=wasm /build/web/wasm/ /app/web/wasm/
EXPOSE 9292
# Single-mode puma (no WEB_CONCURRENCY): the in-process rate limiter
# assumes one worker. Binds 0.0.0.0:9292 by default.
CMD ["bundle", "exec", "puma", "-p", "9292"]
