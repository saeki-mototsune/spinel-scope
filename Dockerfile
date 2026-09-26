# syntax=docker/dockerfile:1
# 4 stages: native → wasm → sandbox → app.
# `app` is LAST so a target-less `docker build .` (= what Kamal runs)
# produces the app image. The sandbox image is built with --target sandbox
# (server/sandbox/build.sh locally, .kamal/hooks/pre-deploy for the VPS).

# ---- Stage 1: patched native spinel -----------------------------------------
# Builds bin/spinel and the runtime archive at /opt/spinel with upstream's own
# Makefile, and records the flags a generated program compiles with
# (`spinel --print-build` -> build.env, sourced by the sandbox's entry.sh).
# Same Debian as the sandbox, so libspinel_rt.a links with its gcc/glibc.
# The context's spinel-src must have had `make deps` (vendor/prism).
FROM debian:12-slim AS native
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/spinel
COPY toolchain/spinel-src/ ./
COPY patches/ /tmp/patches/
COPY server/sandbox/print-build-env.sh /usr/local/bin/print-build-env
# Apply each patch unless the context's tree already carries it (the README
# setup applies them to the submodule working tree). A patch that neither
# applies nor is already applied fails the build.
RUN for p in /tmp/patches/*.patch; do \
      if patch -p1 -R --dry-run -s -f < "$p" > /dev/null 2>&1; then echo "already applied: $p"; \
      else patch -p1 -s -f < "$p"; fi; \
    done \
    && make clean && make -j"$(nproc)" bin/spinel lib/libspinel_rt.a \
    && print-build-env bin/spinel > build.env && cat build.env

# ---- Stage 2: WASM artifacts via emscripten --------------------------------
FROM emscripten/emsdk:6.0.5 AS wasm
WORKDIR /build
COPY toolchain/Makefile toolchain/Makefile
# The patched tree, with the headers upstream's Makefile generated
# (build/csrc/spinel_rev.h, sp_rt_names.h).
COPY --from=native /opt/spinel/ toolchain/spinel-src/
# EMCC=emcc: the emsdk image puts emcc on PATH (no emsdk checkout at the
# path the Makefile defaults to). OUT resolves to /build/web/wasm.
RUN make -C toolchain -j"$(nproc)" EMCC=emcc

# ---- Stage 3: sandbox (compiles+runs user C, one throwaway container/run) --
FROM debian:12-slim AS sandbox
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*
# The runtime headers + libspinel_rt.a, at the path build.env names.
COPY --from=native /opt/spinel/lib/ /opt/spinel/lib/
COPY --from=native /opt/spinel/build.env /opt/spinel/build.env
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
