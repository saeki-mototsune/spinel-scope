// Module worker: runs the three emcc-built spinel stages.
// One module instance per callMain (-sINVOKE_RUN=0 -sEXIT_RUNTIME=1).
const enc = new TextEncoder();
const dec = new TextDecoder();

async function runTool(moduleUrl, files, env, args, outputs) {
  const create = (await import(moduleUrl)).default;
  let stderr = "";
  const mod = await create({
    print: () => {},
    printErr: (line) => { stderr += line + "\n"; },
    preRun: [(m) => Object.assign(m.ENV, env)],
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
    else { stderr += String(e) + "\n"; code = -1; }
  }
  const result = {};
  if (code === 0) {
    for (const name of outputs) {
      result[name] = dec.decode(mod.FS.readFile(`/job/${name}`));
    }
  }
  return { code, stderr, files: result };
}

self.onmessage = async ({ data }) => {
  const { runId, source } = data;
  const stamp = () => performance.now();
  let stage = "parse";

  try {
    let t = stamp();
    const parse = await runTool("/wasm/spinel_parse.mjs", { "in.rb": source },
      { SPINEL_AST_LOCATIONS: "loc.txt" }, ["in.rb", "out.ast"],
      ["out.ast", "loc.txt", "loc.txt.src"]);
    if (parse.code !== 0) {
      postMessage({ runId, stage: "parse", ok: false, ms: Math.round(stamp() - t), stderr: parse.stderr });
      return;
    }
    const artifacts = {
      ast: parse.files["out.ast"], loc: parse.files["loc.txt"], locSrc: parse.files["loc.txt.src"],
    };
    postMessage({ runId, stage: "parse", ok: true, ms: Math.round(stamp() - t), artifacts: { ...artifacts } });

    stage = "analyze";
    t = stamp();
    const analyze = await runTool("/wasm/spinel_analyze.mjs",
      { "in.ast": artifacts.ast }, {}, ["in.ast", "out.ir"], ["out.ir"]);
    if (analyze.code !== 0) {
      postMessage({ runId, stage: "analyze", ok: false, ms: Math.round(stamp() - t), stderr: analyze.stderr });
      return;
    }
    artifacts.ir = analyze.files["out.ir"];
    postMessage({ runId, stage: "analyze", ok: true, ms: Math.round(stamp() - t), artifacts: { ir: artifacts.ir } });

    stage = "codegen";
    t = stamp();
    const codegen = await runTool("/wasm/spinel_codegen.mjs",
      { "in.ast": artifacts.ast, "in.ir": artifacts.ir }, {},
      ["in.ast", "in.ir", "out.c"], ["out.c"]);
    if (codegen.code !== 0) {
      postMessage({ runId, stage: "codegen", ok: false, ms: Math.round(stamp() - t), stderr: codegen.stderr });
      return;
    }
    postMessage({ runId, stage: "codegen", ok: true, ms: Math.round(stamp() - t), artifacts: { c: codegen.files["out.c"] } });
  } catch (e) {
    postMessage({ runId, stage, ok: false, ms: 0, stderr: "worker internal error: " + String(e) });
  }
};
