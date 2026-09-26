// The typed view of one compile, from `spinel --emit-types`: method
// signatures (as RBS), the diagnostics, what codegen decided per call, and
// the type of every typed node. The raw toggle shows the JSON itself.
import { enclosingClassNames, typeLabel } from "../mapping.js";

const body = document.querySelector("#pane-types .pane-body");
const toggle = document.querySelector("#pane-types .pane-toggle");

let lastIndex = null;
let lastRaw = "";

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};
const pos = (r) => `L${r.line}:${r.col + 1}`;
// spinel renames block parameters apart (`w` -> `w__bp9`); show the source name
const displayName = (name) => name?.replace(/__bp\d+$/, "");

function methodRow(m) {
  const row = el("div", "ty-method");
  row.dataset.methodKey = m.key;
  const name = m.singleton ? `self.${m.name}` : m.name;
  row.textContent = `def ${name}: ${m.signature ?? "?"}`;
  if (m.widened) row.appendChild(el("span", "ty-badge", "widened"));
  return row;
}

// Instance variables by the class whose body they appear in.
function ivarsByClass(index) {
  const ivarRecs = index.typeRecords.filter((r) => r.kind.startsWith("InstanceVariable") && r.nodeId != null);
  const ids = new Set(ivarRecs.map((r) => r.nodeId));
  const clsOf = enclosingClassNames(index.ast, (n) => ids.has(n.id));
  const out = new Map(); // class -> Map(name -> rec)
  for (const r of ivarRecs) {
    const cls = clsOf.get(r.nodeId);
    if (!cls) continue;
    if (!out.has(cls)) out.set(cls, new Map());
    if (!out.get(cls).has(r.name)) out.get(cls).set(r.name, r);
  }
  return out;
}

function signatures(index) {
  const frag = document.createDocumentFragment();
  const methods = [...index.methods.values()];
  const ivars = ivarsByClass(index);
  const owners = [...new Set([...methods.map((m) => m.owner), ...ivars.keys()])];
  if (owners.length === 0) return frag;
  frag.appendChild(el("div", "ty-section dim", "シグネチャ (RBS)"));
  for (const owner of owners) {
    const own = methods.filter((m) => m.owner === owner);
    if (owner === "Object") {
      for (const m of own) frag.appendChild(methodRow(m));
      continue;
    }
    const box = el("div", "ty-class");
    box.appendChild(el("div", "ty-class-head", `class ${owner}`));
    for (const [name, r] of ivars.get(owner) ?? []) {
      const row = el("div", "ty-ivar ty-node", `${name}: ${r.rbs}`);
      row.dataset.nodeId = String(r.nodeId);
      box.appendChild(row);
    }
    for (const m of own) box.appendChild(methodRow(m));
    box.appendChild(el("div", "ty-class-head", "end"));
    frag.appendChild(box);
  }
  return frag;
}

function diagnostics(index) {
  const frag = document.createDocumentFragment();
  if (index.diagnostics.length === 0) return frag;
  frag.appendChild(el("div", "ty-section dim", `診断 (${index.diagnostics.length})`));
  index.diagnostics.forEach((d, i) => {
    const row = el("div", `ty-diag ty-diag-${d.severity}`, `${pos(d)} ${d.severity}: ${d.message}`);
    row.dataset.diagIndex = String(i);
    frag.appendChild(row);
  });
  return frag;
}

function codegenRow(r) {
  let text;
  if (r.kind === "BlockNode") {
    text = `${pos(r)} block → ${r.inlined ? "インライン展開" : "関数化"}`;
  } else {
    text = `${pos(r)} ${r.name} → ${r.dispatch}`;
    if (r.callee) text += ` (${r.callee})`;
    if (r.candidates) text += ` [${r.candidates.join(", ")}]`;
  }
  const row = el("div", "ty-call ty-node", text);
  if (r.nodeId != null) row.dataset.nodeId = String(r.nodeId);
  return row;
}

function codegen(index) {
  const details = el("details");
  details.open = true;
  details.appendChild(el("summary", "dim", `codegen の判断 (${index.codegen.length})`));
  for (const r of index.codegen) details.appendChild(codegenRow(r));
  return details;
}

function nodeTypes(index) {
  const details = el("details");
  details.appendChild(el("summary", "dim", `ノードの型 (${index.typeRecords.length})`));
  for (const r of index.typeRecords) {
    const name = r.name != null ? ` "${displayName(r.name)}"` : "";
    const row = el("div", "ty-node ty-nodetype", `${pos(r)} ${r.kind}${name} : ${typeLabel(r)}`);
    if (r.nodeId != null) row.dataset.nodeId = String(r.nodeId);
    details.appendChild(row);
  }
  return details;
}

export function showPretty(index, rawText) {
  lastIndex = index;
  lastRaw = rawText;
  toggle.dataset.mode = "pretty";
  toggle.textContent = "生 JSON";
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  frag.appendChild(signatures(index));
  frag.appendChild(diagnostics(index));
  if (index.codegen.length > 0) frag.appendChild(codegen(index));
  frag.appendChild(nodeTypes(index));
  body.appendChild(frag);
  setStale(false);
}

export function showRaw(text) {
  lastRaw = text;
  toggle.dataset.mode = "raw";
  toggle.textContent = "整形表示";
  body.innerHTML = "";
  body.appendChild(el("pre", null, text));
  setStale(false);
}

toggle.addEventListener("click", () => {
  if (toggle.dataset.mode === "pretty") showRaw(lastRaw);
  else if (lastIndex) showPretty(lastIndex, lastRaw);
});

// A refused compile: spinel's stderr, then the diagnostics its types JSON
// carries (with positions, so they still highlight in the Ruby pane).
export function showError(stderr, diagIndex = null) {
  lastIndex = null;
  body.innerHTML = "";
  body.appendChild(el("div", "err-text", stderr || "(no stderr)"));
  if (diagIndex) body.appendChild(diagnostics(diagIndex));
  setStale(false);
}

export function setStale(on) {
  body.classList.toggle("stale", on);
}
