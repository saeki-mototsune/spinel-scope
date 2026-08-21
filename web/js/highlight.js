import * as editor from "./panels/editor.js";

let index = null;
let rubyEnabled = true;
let methodByDefId = new Map();

function smallestNodeAt(charIndex) {
  let best = null;
  for (const [id, info] of index.byNode) {
    if (!info.range) continue;
    const [s, e] = info.range;
    if (charIndex >= s && charIndex < e) {
      if (!best || e - s < best.width) best = { id, info, width: e - s };
    }
  }
  return best;
}

function clearAll() {
  editor.clearHighlight();
  editor.hideTooltip();
  for (const el of document.querySelectorAll(".ast-node.hl, .ir-ndtype.hl, .ir-method.hl, .c-line.hl")) {
    el.classList.remove("hl");
  }
}

// Adds .hl to the IR method row and (if the method survived into C) its
// C-pane lines. Does not touch the Ruby overlay or call clearAll — callers
// decide whether/how the Ruby side is highlighted.
function highlightMethodPanes(key) {
  const m = index.methods.get(key);
  if (!m) return;
  document.querySelector(`#pane-ir .ir-method[data-method-key="${CSS.escape(key)}"]`)?.classList.add("hl");
  if (m.cRange) {
    for (const el of document.querySelectorAll(`#pane-c .c-line[data-method-key="${CSS.escape(key)}"]`)) {
      el.classList.add("hl");
    }
  }
}

function highlightMethod(key) {
  clearAll();
  const m = index.methods.get(key);
  if (!m) return;
  if (m.rubyRange && rubyEnabled) editor.highlightRange(m.rubyRange);
  highlightMethodPanes(key);
}

function highlightNode(id, { fromRuby = false, hoverChar = null } = {}) {
  clearAll();
  const info = index.byNode.get(id);
  if (!info) return;
  if (info.range && rubyEnabled) editor.highlightRange(info.range);
  document.querySelector(`#pane-ast .ast-node[data-node-id="${id}"]`)?.classList.add("hl");
  document.querySelector(`#pane-ir .ir-ndtype[data-node-id="${id}"]`)?.classList.add("hl");
  if (rubyEnabled && fromRuby && info.type && hoverChar != null) {
    const nodeType = index.ast.nodes.get(id)?.type ?? "";
    editor.showTooltip(hoverChar, `${nodeType} — 推論型: ${info.type}`);
  }
  const methodKey = methodByDefId.get(id);
  if (methodKey) highlightMethodPanes(methodKey);
}

export function wireHighlights(newIndex, { rubyEnabled: enabled = true } = {}) {
  index = newIndex;
  rubyEnabled = enabled;
  methodByDefId = new Map();
  for (const [key, m] of index.methods) {
    if (m.defId != null) methodByDefId.set(m.defId, key);
  }
  clearAll();
}

// Drops the cross-highlight index and clears any live highlight/tooltip.
// Called whenever the previous run's AST/IR/C text is about to go stale
// (sample switch, edit) so hover handlers don't map old node ranges onto
// new text.
export function disableHighlights() {
  index = null;
  clearAll();
}

// Module-level, one-time wiring: ES modules are evaluated once, so these
// listeners are attached exactly once regardless of how many times
// wireHighlights() is called (once per pipeline run). Each handler reads
// the module-level `index`/`rubyEnabled` set by the most recent
// wireHighlights() call, guarded by `if (!index) return;` for the case
// where no run has completed yet.
editor.onHoverChar((charIndex) => {
  if (!index) return;
  if (!rubyEnabled || charIndex == null) { clearAll(); return; }
  const hit = smallestNodeAt(charIndex);
  if (hit) highlightNode(hit.id, { fromRuby: true, hoverChar: charIndex });
  else clearAll();
});

const astBody = document.querySelector("#pane-ast .pane-body");
astBody.addEventListener("mouseover", (e) => {
  if (!index) return;
  const el = e.target.closest?.(".ast-node");
  if (el) highlightNode(parseInt(el.dataset.nodeId, 10));
});
astBody.addEventListener("mouseleave", clearAll);

const irBody = document.querySelector("#pane-ir .pane-body");
irBody.addEventListener("mouseover", (e) => {
  if (!index) return;
  const ndtype = e.target.closest?.(".ir-ndtype");
  if (ndtype) { highlightNode(parseInt(ndtype.dataset.nodeId, 10)); return; }
  const method = e.target.closest?.(".ir-method");
  if (method) highlightMethod(method.dataset.methodKey);
});
irBody.addEventListener("mouseleave", clearAll);

const cBody = document.querySelector("#pane-c .pane-body");
cBody.addEventListener("mouseover", (e) => {
  if (!index) return;
  const el = e.target.closest?.(".c-line[data-method-key]");
  if (el) highlightMethod(el.dataset.methodKey);
});
cBody.addEventListener("mouseleave", clearAll);
