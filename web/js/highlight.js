import * as editor from "./panels/editor.js";
import * as cPane from "./panels/cpane.js";

let index = null;
let rubyEnabled = true;
let methodByDefId = new Map();

// The tightest node over a character. Nodes sharing a span (an
// ArgumentsNode and its one IntegerNode) resolve to the typed one, then the
// deeper one (children are numbered after their parents).
function smallestNodeAt(charIndex) {
  let best = null;
  for (const [id, info] of index.byNode) {
    if (!info.range) continue;
    const [s, e] = info.range;
    if (charIndex < s || charIndex >= e) continue;
    const width = e - s;
    const better = !best || width < best.width
      || (width === best.width && (!!info.type > !!best.info.type || (!!info.type === !!best.info.type && id > best.id)));
    if (better) best = { id, info, width };
  }
  return best;
}

function clearAll() {
  editor.clearHighlight();
  editor.hideTooltip();
  for (const el of document.querySelectorAll(".ast-node.hl, .ty-node.hl, .ty-method.hl, .ty-diag.hl, .c-line.hl")) {
    el.classList.remove("hl");
  }
}

// Adds .hl to the types-pane method row and (if the method survived into C)
// its C function. Does not touch the Ruby overlay or call clearAll — callers
// decide whether/how the Ruby side is highlighted.
function highlightMethodPanes(key, { reveal = true } = {}) {
  const m = index.methods.get(key);
  if (!m) return;
  document.querySelector(`#pane-types .ty-method[data-method-key="${CSS.escape(key)}"]`)?.classList.add("hl");
  if (m.cRange) {
    const lines = document.querySelectorAll(`#pane-c .c-line[data-method-key="${CSS.escape(key)}"]`);
    for (const el of lines) el.classList.add("hl");
    if (reveal) lines[0]?.scrollIntoView({ block: "nearest" });
  }
}

function highlightMethod(key, { fromC = false } = {}) {
  clearAll();
  const m = index.methods.get(key);
  if (!m) return;
  if (m.rubyRange && rubyEnabled) editor.highlightRange(m.rubyRange);
  highlightMethodPanes(key, { reveal: !fromC });
}

function tooltipFor(id, info) {
  const nodeType = index.ast.nodes.get(id)?.type ?? "";
  let text = `${nodeType} — 型: ${info.type}`;
  const call = index.codegen.find((r) => r.nodeId === id);
  if (call?.dispatch) text += ` · ${call.dispatch}${call.callee ? ` → ${call.callee}` : ""}`;
  return text;
}

function highlightNode(id, { fromRuby = false, hoverChar = null } = {}) {
  clearAll();
  const info = index.byNode.get(id);
  if (!info) return;
  if (info.range && rubyEnabled) editor.highlightRange(info.range);
  document.querySelector(`#pane-ast .ast-node[data-node-id="${id}"]`)?.classList.add("hl");
  for (const el of document.querySelectorAll(`#pane-types .ty-node[data-node-id="${id}"]`)) el.classList.add("hl");
  // the C that came from the node's Ruby lines (spinel's #line directives)
  const node = index.ast.nodes.get(id);
  if (info.inSource && node?.line != null) cPane.highlightRubyLines(node.line, node.endLine ?? node.line, { reveal: true });
  if (rubyEnabled && fromRuby && info.type && hoverChar != null) {
    editor.showTooltip(hoverChar, tooltipFor(id, info));
  }
  const methodKey = methodByDefId.get(id);
  if (methodKey) highlightMethodPanes(methodKey);
}

// A C line: its function's header stands for the whole method; any other
// line maps back to the Ruby line its #line directive names.
function highlightCLine(el) {
  if (el.classList.contains("c-method")) { highlightMethod(el.dataset.methodKey, { fromC: true }); return; }
  const rubyLine = el.dataset.rubyLine;
  if (rubyLine == null) {
    if (el.dataset.methodKey) highlightMethod(el.dataset.methodKey, { fromC: true });
    return;
  }
  clearAll();
  const line = parseInt(rubyLine, 10);
  const range = index.lineRange(line);
  if (range && rubyEnabled) editor.highlightRange(range);
  cPane.highlightRubyLines(line, line);
}

function highlightDiagnostic(i) {
  clearAll();
  const d = index.diagnostics[i];
  if (!d) return;
  document.querySelector(`#pane-types .ty-diag[data-diag-index="${i}"]`)?.classList.add("hl");
  if (d.range && rubyEnabled) editor.highlightRange(d.range);
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
// Called whenever the previous run's AST/types/C text is about to go stale
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

const typesBody = document.querySelector("#pane-types .pane-body");
typesBody.addEventListener("mouseover", (e) => {
  if (!index) return;
  const node = e.target.closest?.(".ty-node[data-node-id]");
  if (node) { highlightNode(parseInt(node.dataset.nodeId, 10)); return; }
  const method = e.target.closest?.(".ty-method");
  if (method) { highlightMethod(method.dataset.methodKey); return; }
  const diag = e.target.closest?.(".ty-diag");
  if (diag) highlightDiagnostic(parseInt(diag.dataset.diagIndex, 10));
});
typesBody.addEventListener("mouseleave", clearAll);

const cBody = document.querySelector("#pane-c .pane-body");
cBody.addEventListener("mouseover", (e) => {
  if (!index) return;
  const el = e.target.closest?.(".c-line");
  if (el && (el.dataset.rubyLine != null || el.dataset.methodKey)) highlightCLine(el);
});
cBody.addEventListener("mouseleave", clearAll);
