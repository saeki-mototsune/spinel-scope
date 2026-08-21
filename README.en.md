# spinel visualize

**Demo: https://spinel-scope.mototsune.dev** | [日本語 (full documentation)](README.md)

A learning-oriented web service for watching [**spinel**](https://github.com/matz/spinel) — matz's Ruby AOT compiler — process a Ruby program stage by stage in the browser:

**parse → type inference (analyze) → C generation (codegen) → compile (cc) → run**

- Five synchronized panels (Ruby / AST / typed IR / generated C / output) plus a stage bar
- **Cross-highlighting**: hover any element in any panel and the corresponding pieces light up in all panels, with inferred-type tooltips on Ruby expressions (e.g. `fib(n - 1)` → `int`)
- AST / IR panels can toggle between pretty-printed views and spinel's raw intermediate files (`.ast` / `.ir`)

## Architecture

parse / analyze / codegen run entirely in the browser as WASM (built from spinel with the minimal patches in `patches/`). Only the final compile-and-run step goes to the server, which spawns a throwaway Docker sandbox per request (no network, read-only rootfs, non-root, 1 CPU / 256MB / 15s total). The server only ever receives generated C source and treats it as fully untrusted.

The deploy setup (Kamal on a single VPS) and full setup/test instructions are documented in the [Japanese README](README.md).

## Quick start

```bash
git submodule update --init --depth 1 toolchain/spinel-src
(cd toolchain/spinel-src && git apply ../../patches/*.patch && make deps && make)
git clone https://github.com/emscripten-core/emsdk.git toolchain/emsdk
toolchain/emsdk/emsdk install 4.0.6 && toolchain/emsdk/emsdk activate 4.0.6
make -C toolchain
server/sandbox/build.sh
(cd server && bundle install && bundle exec puma -p 9292)
# → http://localhost:9292
```

## License

[MIT](LICENSE). spinel (Yukihiro Matsumoto) and its vendored prism (Shopify) are also MIT-licensed; this repository does not bundle spinel's source — it is referenced as a git submodule (`toolchain/spinel-src`), and the patches in `patches/` are diffs against it under the same license.

See also [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
