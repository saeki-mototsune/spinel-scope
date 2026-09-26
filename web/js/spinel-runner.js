// Runs the emscripten-built spinel compiler (web/wasm/spinel.mjs). Shared by
// the Worker (worker.js) and the node golden runner (test/golden/run-wasm.mjs)
// so both drive the module the same way. No DOM access.
//
// The module is built with -sINVOKE_RUN=0 -sEXIT_RUNTIME=1: one instance per
// callMain. stdout/stderr are captured byte-exact through FS.init (the
// print/printErr hooks are line-based and lose the trailing newline).

// spinel resolves builtins/*.rb beside its binary. The module embeds them at
// /spinel/builtins (toolchain/Makefile), so argv[0] names /spinel/spinel --
// upstream's installed layout (`make install`: $SPNLDIR/{spinel,builtins/}).
const THIS_PROGRAM = "/spinel/spinel";
// The Ruby file name the user's program is compiled as. It shows up in the
// AST (SOURCE_FILE), the types JSON ("file") and the C (#line).
export const SOURCE_NAME = "main.rb";

const enc = new TextEncoder();
const dec = new TextDecoder();

function sink() {
  const bytes = [];
  return {
    push: (c) => { if (c !== null && c !== undefined) bytes.push(c & 0xff); },
    text: () => dec.decode(new Uint8Array(bytes)),
  };
}

// Runs `spinel <args>` in a fresh instance with `files` in its cwd.
// `wasmModule` (a compiled WebAssembly.Module) skips re-fetching and
// re-compiling the 5MB binary on every run.
// Returns { code, stdout, stderr, files: {name: text} } where files holds
// each of `outputs` that the run left behind (whatever the exit code: a
// refused compile still writes its types JSON).
export async function runSpinel(factory, { args, files = {}, env = {}, outputs = [] }, { wasmModule } = {}) {
  const out = sink();
  const err = sink();
  const mod = await factory({
    thisProgram: THIS_PROGRAM,
    ...(wasmModule ? {
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(wasmModule, imports).then((instance) => receive(instance, wasmModule));
        return {};
      },
    } : {}),
    print: () => {},
    printErr: () => {},
    preRun: [(m) => {
      Object.assign(m.ENV, env);
      m.FS.init(() => null, out.push, err.push);
    }],
  });
  mod.FS.mkdir("/job");
  for (const [name, text] of Object.entries(files)) {
    mod.FS.writeFile(`/job/${name}`, enc.encode(text));
  }
  mod.FS.chdir("/job");
  let code = 0;
  try {
    code = mod.callMain(args);
  } catch (e) {
    if (e && e.name === "ExitStatus") code = e.status;
    else return { code: -1, stdout: out.text(), stderr: err.text() + String(e) + "\n", files: {} };
  }
  const result = {};
  for (const name of outputs) {
    try { result[name] = dec.decode(mod.FS.readFile(`/job/${name}`)); } catch { /* not written */ }
  }
  return { code, stdout: out.text(), stderr: err.text(), files: result };
}

// The two runs a visualization makes. Parse: the text AST with every node's
// span (SPINEL_EMIT_TYPES adds node_end_line/node_end_col). Compile: one
// full compile that writes the types JSON, the symbol map, and the C (-S, on
// stdout).
export function parseRun(source) {
  return {
    args: [SOURCE_NAME, "--dump-ast"],
    files: { [SOURCE_NAME]: source },
    env: { SPINEL_EMIT_TYPES: "1" },
  };
}

export function compileRun(source) {
  return {
    args: [SOURCE_NAME, "--emit-types", "-o", "types.json", "-S"],
    files: { [SOURCE_NAME]: source },
    // codegen writes the emitted-symbol -> Ruby-name map here in the same
    // compile (the hook --profile uses for its <out>.symbols.json)
    env: { SPINEL_PROFILE_SYMBOL_MAP: "symbols.json" },
    outputs: ["types.json", "symbols.json"],
  };
}
