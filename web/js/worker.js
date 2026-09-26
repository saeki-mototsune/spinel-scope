// Module worker: runs the emcc-built spinel compiler twice per visualization
// (see spinel-runner.js): `--dump-ast` for the parse stage, then one compile
// that yields the types JSON, the symbol map and the C.
import { runSpinel, parseRun, compileRun } from "./spinel-runner.js";

const MODULE_URL = "/wasm/spinel.mjs";
const WASM_URL = "/wasm/spinel.wasm";

// The factory and the compiled binary are loaded once per worker; a failed
// load is dropped so the next run retries it.
let loading = null;
function loadSpinel() {
  if (!loading) {
    loading = Promise.all([
      import(MODULE_URL).then((m) => m.default),
      WebAssembly.compileStreaming(fetch(WASM_URL)),
    ]).then(([factory, wasmModule]) => ({ factory, wasmModule }));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// spinel reports the JSON it wrote on stderr; that is not a diagnostic.
const cleanStderr = (s) => s.split("\n").filter((l) => !/^Wrote \S+\.json$/.test(l)).join("\n").trim();

self.onmessage = async ({ data }) => {
  const { runId, source } = data;
  const stamp = () => performance.now();
  let stage = "parse";

  try {
    let t = stamp();
    const { factory, wasmModule } = await loadSpinel();
    const parse = await runSpinel(factory, parseRun(source), { wasmModule });
    if (parse.code !== 0) {
      postMessage({ runId, stage: "parse", ok: false, ms: Math.round(stamp() - t), stderr: cleanStderr(parse.stderr) });
      return;
    }
    postMessage({ runId, stage: "parse", ok: true, ms: Math.round(stamp() - t), artifacts: { ast: parse.stdout } });

    stage = "compile";
    t = stamp();
    const compile = await runSpinel(factory, compileRun(source), { wasmModule });
    const artifacts = {
      types: compile.files["types.json"] ?? "",
      symbols: compile.files["symbols.json"] ?? "",
    };
    if (compile.code !== 0) {
      // A refused compile still writes its types JSON (the refusals are its
      // error diagnostics), so the types pane can show where they are.
      postMessage({ runId, stage, ok: false, ms: Math.round(stamp() - t), stderr: cleanStderr(compile.stderr), artifacts });
      return;
    }
    postMessage({ runId, stage, ok: true, ms: Math.round(stamp() - t), artifacts: { ...artifacts, c: compile.stdout } });
  } catch (e) {
    postMessage({ runId, stage, ok: false, ms: 0, stderr: "worker internal error: " + String(e) });
  }
};
