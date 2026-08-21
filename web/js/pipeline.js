// Orchestrates one visualization run. Stale results are dropped by runId.
let worker = null;
let currentRunId = 0;

function ensureWorker() {
  if (!worker) worker = new Worker("js/worker.js", { type: "module" });
  return worker;
}

export function runPipeline(source, { onStage, onWasmDone }) {
  const runId = ++currentRunId;
  const artifacts = { source };
  const w = ensureWorker();
  w.onmessage = ({ data }) => {
    if (data.runId !== runId) return;
    Object.assign(artifacts, data.artifacts || {});
    onStage(data.stage, data);
    if (data.stage === "codegen" && data.ok) {
      // onWasmDone is async (it awaits the compile/run API call) and nothing
      // here awaits it. Without this catch, a throw inside it (e.g. from
      // buildIndex/showTree) becomes an unhandled promise rejection instead
      // of a reported stage failure, leaving the stage chips frozen.
      Promise.resolve(onWasmDone(artifacts)).catch((e) => {
        onStage("cc", { ok: false, ms: 0, stderr: "index build failed: " + String(e) });
      });
    }
  };
  w.onerror = (e) => {
    if (runId !== currentRunId) return;
    onStage("parse", { ok: false, ms: 0, stderr: "worker load error: " + (e.message || String(e)) });
  };
  w.postMessage({ runId, source });
  return runId;
}

export function isCurrentRun(runId) {
  return runId === currentRunId;
}
