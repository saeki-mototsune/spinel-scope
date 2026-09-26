import { setStage, resetStages } from "./panels/stagebar.js";
import { runPipeline, isCurrentRun } from "./pipeline.js";
import * as astPane from "./panels/ast.js";
import * as typesPane from "./panels/types.js";
import * as cPane from "./panels/cpane.js";
import { compileRun } from "./api.js";
import * as outputPane from "./panels/output.js";
import { buildIndex } from "./mapping.js";
import { SOURCE_NAME } from "./spinel-runner.js";
import * as editor from "./panels/editor.js";
import { wireHighlights, disableHighlights } from "./highlight.js";

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

function markAllStale() {
  astPane.setStale(true);
  typesPane.setStale(true);
  cPane.setStale(true);
  outputPane.setStale(true);
  disableHighlights();
}

async function selectSample(file) {
  try {
    const res = await fetch(`samples/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    editor.setValue(await res.text());
    resetStages();
    markAllStale();
  } catch (e) {
    showSampleLoadError(e.message || String(e));
  }
}

sampleSelect.addEventListener("change", () => selectSample(sampleSelect.value));

loadSamples();

const runBtn = document.getElementById("run-btn");

editor.onEdit(markAllStale);

// Says where the Ruby pane is not mapped: nowhere when spinel's positions
// describe some other text, or on the lines spinel rewrote (see buildIndex).
function showMapNotice(index) {
  const head = document.querySelector("#pane-ruby .pane-head");
  const notice = head.querySelector(".map-notice");
  if (!index.positionsMatchSource) {
    notice.textContent = "位置対応オフ(spinel の位置情報がソースと一致しないため)";
  } else if (index.rewrittenLines.length > 0) {
    notice.textContent = `${index.rewrittenLines.join(", ")} 行目は位置対応オフ(spinel が構文糖衣を書き換えて解析するため)`;
  }
  head.classList.toggle("map-off", !index.positionsMatchSource || index.rewrittenLines.length > 0);
}

// Builds the cross-highlight index and hands it to the panes. Ruby-side
// highlighting stays off when spinel's positions do not describe the text
// in the editor (see buildIndex).
function indexArtifacts(artifacts) {
  const index = buildIndex({
    source: artifacts.source,
    sourceName: SOURCE_NAME,
    astText: artifacts.ast,
    typesJson: artifacts.types ?? "",
    symbolsJson: artifacts.symbols ?? "",
    cText: artifacts.c ?? "",
  });
  astPane.showTree(index, artifacts.ast);
  wireHighlights(index, { rubyEnabled: index.positionsMatchSource });
  showMapNotice(index);
  return index;
}

function run() {
  resetStages();
  markAllStale();
  setStage("parse", "running");
  const artifacts = { source: editor.getValue() };
  const runId = runPipeline(artifacts.source, {
    onStage(stage, result) {
      setStage(stage, result.ok ? "ok" : "fail", result.ms);
      if (stage === "parse") {
        if (!result.ok) { astPane.showError(result.stderr || "(no stderr)"); return; }
        artifacts.ast = result.artifacts.ast;
        astPane.showRaw(artifacts.ast);
        setStage("compile", "running");
        return;
      }
      if (stage === "compile") {
        if (result.ok) {
          typesPane.showRaw(result.artifacts.types);
          cPane.showRaw(result.artifacts.c);
          return;
        }
        // A refused compile: the AST and the diagnostics' positions still
        // map onto the source, so index what there is.
        Object.assign(artifacts, result.artifacts || {});
        let index = null;
        try { index = indexArtifacts(artifacts); } catch { /* keep the raw panes */ }
        typesPane.showError(result.stderr, index);
        cPane.showError("C は生成されませんでした(analyze / codegen の失敗)");
        return;
      }
      // post-compile failures (e.g. index build errors reported under "cc")
      if (!result.ok) outputPane.showNetworkError(result.stderr || "(no stderr)");
    },
    async onWasmDone(done) {
      const myRun = runId;
      const index = indexArtifacts(done);
      typesPane.showPretty(index, done.types);
      cPane.showCode(index, done.c);
      setStage("cc", "running");
      outputPane.showRunning();
      const t = performance.now();
      const r = await compileRun(done.c);
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
