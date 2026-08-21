import { setStage, resetStages } from "./panels/stagebar.js";
import { runPipeline, isCurrentRun } from "./pipeline.js";
import * as astPane from "./panels/ast.js";
import * as irPane from "./panels/ir.js";
import * as cPane from "./panels/cpane.js";
import { compileRun } from "./api.js";
import * as outputPane from "./panels/output.js";
import { buildIndex } from "./mapping.js";
import * as editor from "./panels/editor.js";
import { wireHighlights, disableHighlights } from "./highlight.js";

let currentIndex = null;

const sampleSelect = document.getElementById("sample-select");

function showSampleLoadError(detail) {
  const body = document.querySelector("#pane-ruby .pane-body");
  const div = document.createElement("div");
  div.className = "err-text";
  div.textContent = `サンプルを読み込めませんでした: ${detail}`;
  body.appendChild(div);
}

async function loadSamples() {
  try {
    const res = await fetch("samples/manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    for (const { file, label } of manifest) {
      const opt = document.createElement("option");
      opt.value = file;
      opt.textContent = `サンプル: ${label}`;
      sampleSelect.appendChild(opt);
    }
    await selectSample(manifest[0].file);
  } catch (e) {
    showSampleLoadError(e.message || String(e));
  }
}

async function selectSample(file) {
  try {
    const res = await fetch(`samples/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    editor.setValue(await res.text());
    resetStages();
    astPane.setStale(true);
    irPane.setStale(true);
    cPane.setStale(true);
    outputPane.setStale(true);
    disableHighlights();
  } catch (e) {
    showSampleLoadError(e.message || String(e));
  }
}

sampleSelect.addEventListener("change", () => selectSample(sampleSelect.value));

loadSamples();

const runBtn = document.getElementById("run-btn");
const panes = { parse: astPane, analyze: irPane, codegen: cPane };

editor.onEdit(() => {
  astPane.setStale(true);
  irPane.setStale(true);
  cPane.setStale(true);
  outputPane.setStale(true);
  disableHighlights();
});

function run() {
  resetStages();
  astPane.setStale(true);
  irPane.setStale(true);
  cPane.setStale(true);
  outputPane.setStale(true);
  setStage("parse", "running");
  const runId = runPipeline(editor.getValue(), {
    onStage(stage, result) {
      setStage(stage, result.ok ? "ok" : "fail", result.ms);
      if (!result.ok) {
        // `panes` only covers the wasm stages (parse/analyze/codegen). A
        // post-codegen failure reported under stage "cc" (e.g. index build
        // errors caught in onWasmDone below) has no matching pane — route it
        // to the output pane instead of throwing on a missing lookup.
        if (panes[stage]) panes[stage].showError(result.stderr || "(no stderr)");
        else outputPane.showNetworkError(result.stderr || "(no stderr)");
        return;
      }
      if (stage === "parse") { astPane.showRaw(result.artifacts.ast); setStage("analyze", "running"); }
      if (stage === "analyze") { irPane.showRaw(result.artifacts.ir); setStage("codegen", "running"); }
      if (stage === "codegen") { cPane.showRaw(result.artifacts.c); }
    },
    async onWasmDone(artifacts) {
      const myRun = runId;
      currentIndex = buildIndex({
        source: artifacts.source,
        astText: artifacts.ast,
        locText: artifacts.loc,
        irText: artifacts.ir,
        cText: artifacts.c,
      });
      astPane.showTree(currentIndex, artifacts.ast);
      irPane.showPretty(currentIndex, artifacts.ir);
      cPane.showCode(currentIndex, artifacts.c);
      const srcMatches = artifacts.source === artifacts.locSrc;
      wireHighlights(currentIndex, { rubyEnabled: srcMatches });
      document.querySelector("#pane-ruby .pane-head").classList.toggle("map-off", !srcMatches);
      setStage("cc", "running");
      outputPane.showRunning();
      const t = performance.now();
      const r = await compileRun(artifacts.c);
      if (!isCurrentRun(myRun)) return;
      const ms = Math.round(performance.now() - t);
      if (r.networkError) {
        setStage("cc", "fail", ms);
        outputPane.showNetworkError(r.message);
        return;
      }
      if (r.apiError) {
        setStage("cc", "fail", ms);
        outputPane.showNetworkError(`API エラー: ${r.apiError}`);
        return;
      }
      if (r.cc_exit !== 0) {
        setStage("cc", "fail", ms);
        setStage("run", "idle");
        outputPane.showResult(r);
        return;
      }
      setStage("cc", "ok", ms);
      setStage("run", r.timed_out || r.run_exit !== 0 ? "fail" : "ok", r.duration_ms);
      outputPane.showResult(r);
    },
  });
}

runBtn.addEventListener("click", run);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

for (const head of document.querySelectorAll(".col .pane-head")) {
  head.addEventListener("dblclick", () => {
    head.closest(".col").classList.toggle("collapsed");
  });
}
