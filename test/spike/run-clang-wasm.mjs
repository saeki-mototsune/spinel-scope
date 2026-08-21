// Usage: node run-clang-wasm.mjs <clang-wasm> <sysroot-dir> <in.c> <out.wasm> [extra flags...]
// Compiles C using clang-running-on-wasm, i.e. the same binary the browser would run.
//
// Candidate under test: binji/wasm-clang (https://github.com/binji/wasm-clang,
// demo at https://binji.github.io/wasm-clang/, LLVM 8.0.1). This is the only
// candidate of the three tried in Task 2 whose artifacts could actually be
// obtained (llvm-box and emception could not be retrieved as standalone,
// Node-runnable artifacts through any public channel within the spike budget).
// Verdict: FAIL (this candidate's sysroot predates wasm SjLj support), which
// is why parse/analyze/codegen run in-browser but cc+execution moved server-side
// -- see the README's "設計の経緯" section.
//
// binji/wasm-clang's invocation model is fundamentally different from a
// wasi-sdk-style clang and from the WASI-driver skeleton this file's name
// originally implied:
//   - clang/lld/memfs are three separate wasm modules that import from the
//     OLD "wasi_unstable" namespace (a handful of functions only: proc_exit,
//     environ_*_get, args_*_get, random_get -- clock_time_get and
//     poll_oneoff are stubbed to throw) plus a bespoke "memfs" companion
//     module (host_write/host_read/copy_in/copy_out/memfs_log/abort) and a
//     large "canvas_*" import set. None of this is node:wasi-compatible, so
//     this harness ports the demo's own host runtime (App/MemFS/Tar/API
//     classes, from https://binji.github.io/wasm-clang/shared.js, saved
//     verbatim as ./toolchain/clang-wasm/binji-wasm-clang/shared.mjs with a
//     single appended `export default API;` line -- sha256 of that file is
//     recorded in the result doc) instead of node:wasi.
//   - clang is invoked directly in "-cc1 -emit-obj" mode (no clang driver,
//     so no --target=/--sysroot= flags exist). The target triple and the
//     the sysroot are baked into the clang binary and into
//     `API.clangCommonArgs` (isysroot "/", -internal-isystem paths).
//   - Compile and link are two separate wasm-module invocations (clang then
//     wasm-ld), not one driver call. sysroot-dir (2nd CLI arg) is IGNORED:
//     binji bundles its own sysroot.tar (untarred into the in-wasm memfs at
//     "/"), sibling to the clang file. wasi-sdk's sysroot is not
//     ABI-compatible with an LLVM-8 clang and was not attempted.
//
// Flag mapping for the "extra flags" the task specified
// (`-mllvm -wasm-enable-sjlj -lsetjmp`): flags are appended to the compile
// step (clang -cc1), except any flag starting with "-l", which is appended
// to the link step's library list (wasm-ld has no compile phase, so "-l"
// flags cannot apply there).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [clangPath, sysrootDirArg, inC, outWasm, ...extra] = process.argv.slice(2);
if (!clangPath || !inC || !outWasm) {
  console.error('usage: node run-clang-wasm.mjs <clang-wasm> <sysroot-dir> <in.c> <out.wasm> [extra flags...]');
  process.exit(2);
}

const candidateDir = dirname(resolve(clangPath));
const { default: API } = await import(pathToFileURL(join(candidateDir, 'shared.mjs')));

console.error(`[run-clang-wasm] candidate dir: ${candidateDir}`);
console.error(`[run-clang-wasm] sysroot-dir argument ("${sysrootDirArg}") is ignored -- binji/wasm-clang uses its own bundled sysroot.tar`);

const extraCompileFlags = extra.filter((f) => !f.startsWith('-l'));
const extraLinkLibs = extra.filter((f) => f.startsWith('-l'));

const apiOptions = {
  async readBuffer(filename) {
    const buf = await readFile(join(candidateDir, filename));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },
  async compileStreaming(filename) {
    const buf = await readFile(join(candidateDir, filename));
    return WebAssembly.compile(buf);
  },
  hostWrite(s) {
    process.stderr.write(s);
  },
};

const api = new API(apiOptions);
await api.ready; // waits for memfs.wasm init + sysroot.tar untar

const input = 'in.c';
const obj = 'in.o';
const wasmOut = 'out.wasm';

const source = await readFile(inC, 'utf8');
api.memfs.addFile(input, source);

console.error(`[run-clang-wasm] compile: clang -cc1 -emit-obj ${api.clangCommonArgs.join(' ')} -O2 -o ${obj} -x c++ ${input} ${extraCompileFlags.join(' ')}`);
const clang = await api.getModule(api.clangFilename);
await api.run(clang, 'clang', '-cc1', '-emit-obj', ...api.clangCommonArgs, '-O2', '-o', obj, '-x', 'c++', input, ...extraCompileFlags);

const stackSize = 1024 * 1024;
const libdir = 'lib/wasm32-wasi';
const crt1 = `${libdir}/crt1.o`;
const linkArgs = ['--no-threads', '--export-dynamic', '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc', '-lc++', '-lc++abi', '-lcanvas', ...extraLinkLibs, '-o', wasmOut];
console.error(`[run-clang-wasm] link: wasm-ld ${linkArgs.join(' ')}`);
const lld = await api.getModule(api.lldFilename);
await api.run(lld, 'wasm-ld', ...linkArgs);

const outBytes = api.memfs.getFileContents(wasmOut);
await writeFile(outWasm, Buffer.from(outBytes));
console.error(`[run-clang-wasm] wrote ${outWasm} (${outBytes.length} bytes)`);
