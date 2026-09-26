# spinel scope

**Demo: https://spinel-scope.mototsune.dev** | [日本語 (full documentation)](README.md)

A learning-oriented web service for watching [**spinel**](https://github.com/matz/spinel) — matz's Ruby AOT compiler — process a Ruby program stage by stage in the browser:

**parse → type inference (analyze) → C generation (codegen) → compile (cc) → run**

- Five synchronized panels (Ruby / AST / type info / generated C / output) plus a stage bar
- **Cross-highlighting**: hover any element in any panel and the corresponding pieces light up in all panels, with inferred-type tooltips on Ruby expressions (e.g. `fib(n - 1)` → `Integer (int) · direct → fib`); generated C maps back to Ruby line by line via its `#line` directives
- The type-info panel shows method signatures (RBS), diagnostics, codegen's per-call dispatch decisions and every node's type; AST / type info / C can toggle to spinel's raw output (`--dump-ast` text / `--emit-types` JSON / C with `#line`)

## Architecture

spinel is a single C binary that parses (libprism), infers types and generates C in one process. The whole compiler is built with emscripten into one WASM module (with the minimal patches in `patches/`) and run twice per visualization in a Web Worker: `--dump-ast` for the AST with node spans, then one compile that yields the `--emit-types` JSON, the `--emit-symbol-map` JSON and the C. Only the final compile-and-run step goes to the server, which spawns a throwaway Docker sandbox per request (no network, read-only rootfs, non-root, 1 CPU / 256MB / 15s total) and compiles with the flags spinel's own `--print-build` reports. The server only ever receives generated C source and treats it as fully untrusted.

The deploy setup (Kamal on a single VPS) and full setup/test instructions are documented in the [Japanese README](README.md).

## Quick start

```bash
git submodule update --init --depth 1 toolchain/spinel-src
(cd toolchain/spinel-src && git apply ../../patches/*.patch)
make -C toolchain native
git clone https://github.com/emscripten-core/emsdk.git toolchain/emsdk
toolchain/emsdk/emsdk install 6.0.5 && toolchain/emsdk/emsdk activate 6.0.5
make -C toolchain
server/sandbox/build.sh
(cd server && bundle install && bundle exec puma -p 9292)
# → http://localhost:9292
```

## Updating spinel

spinel is pinned as the `toolchain/spinel-src` submodule. To move it to a new upstream release tag (`YYYY.MM.DD`), commit or branch:

```bash
script/update-spinel 2026.10.03    # or a SHA, or master; no argument = newest release tag
```

The script fetches upstream, checks the ref out, runs `git apply --check` on each patch and applies it, rebuilds the native and WASM compilers, regenerates the golden expectations with the native spinel and runs the golden (WASM vs native) and unit tests. Review `git diff test/golden/expected`, rebuild the sandbox (`server/sandbox/build.sh`), run the API / E2E tests, then commit the submodule, `patches/` and the expectations together. Details (in Japanese) are in the README's 「spinel の更新」 section.

## License

[MIT](LICENSE). spinel (Yukihiro Matsumoto) and its vendored prism (Shopify) are also MIT-licensed; this repository does not bundle spinel's source — it is referenced as a git submodule (`toolchain/spinel-src`), and the patches in `patches/` are diffs against it under the same license.

See also [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
