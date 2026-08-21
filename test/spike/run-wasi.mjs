// Usage: node run-wasi.mjs <file.wasm> [args...]
// Runs a wasm32-wasi binary with cwd preopened at /work.
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const [wasmPath, ...args] = process.argv.slice(2);
if (!wasmPath) {
  console.error('usage: node run-wasi.mjs <file.wasm> [args...]');
  process.exit(2);
}
const wasi = new WASI({
  version: 'preview1',
  args: [wasmPath, ...args],
  env: process.env,
  preopens: { '/work': process.cwd() },
});
const wasm = await WebAssembly.compile(await readFile(wasmPath));
const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
process.exit(wasi.start(instance));
