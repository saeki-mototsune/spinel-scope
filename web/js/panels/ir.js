import { classNameOf } from "../mapping.js";

const body = document.querySelector("#pane-ir .pane-body");
const toggle = document.querySelector("#pane-ir .pane-toggle");

let lastIndex = null;
let lastRaw = "";

const sig = (m) =>
  `${m.name}(${m.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) → ${m.ret}`;

// spinel's codegen synthesizes compiler-internal classes (e.g. "Method", the
// wrapper it builds for `obj.method(:foo)`/block-closure values) that never
// existed as a `class ... end` in the user's source. Listing those in a
// teaching-focused IR pane is confusing, so only classes with a matching
// ClassNode in the AST are rendered.
function userDefinedClassNames(ast) {
  const names = new Set();
  for (const node of ast.nodes.values()) {
    if (node.type !== "ClassNode") continue;
    const name = classNameOf(ast, node);
    if (name) names.add(name);
  }
  return names;
}

function methodRow(key, m) {
  const div = document.createElement("div");
  div.className = "ir-method";
  div.dataset.methodKey = key;
  div.textContent = sig(m);
  return div;
}

export function showPretty(index, rawText) {
  lastIndex = index;
  lastRaw = rawText;
  toggle.dataset.mode = "pretty";
  toggle.textContent = "生テキスト";
  body.innerHTML = "";
  const frag = document.createDocumentFragment();

  if (index.ir.methods.length > 0) {
    const h = document.createElement("div");
    h.className = "ir-section dim";
    h.textContent = "メソッド表:";
    frag.appendChild(h);
    for (const m of index.ir.methods) frag.appendChild(methodRow(m.name, m));
  }

  const userClasses = userDefinedClassNames(index.ast);
  for (const cls of index.ir.classes) {
    if (!userClasses.has(cls.name)) continue;
    const box = document.createElement("div");
    box.className = "ir-class";
    const h = document.createElement("div");
    h.className = "ir-section dim";
    h.textContent = `class ${cls.name}:`;
    box.appendChild(h);
    for (const iv of cls.ivars) {
      const row = document.createElement("div");
      row.className = "ir-ivar";
      row.textContent = `${iv.name}: ${iv.type}`;
      box.appendChild(row);
    }
    for (const m of cls.methods) box.appendChild(methodRow(`${cls.name}#${m.name}`, m));
    frag.appendChild(box);
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.className = "dim";
  summary.textContent = `ノード型キャッシュ (${index.ir.nodeTypes.size})`;
  details.appendChild(summary);
  for (const [id, type] of index.ir.nodeTypes) {
    const row = document.createElement("div");
    row.className = "ir-ndtype";
    row.dataset.nodeId = String(id);
    const nodeType = index.ast.nodes.get(id)?.type ?? "?";
    row.textContent = `nd${id} ${nodeType} : ${type}`;
    details.appendChild(row);
  }
  frag.appendChild(details);

  body.appendChild(frag);
  setStale(false);
}

export function showRaw(text) {
  lastRaw = text;
  toggle.dataset.mode = "raw";
  toggle.textContent = "整形表示";
  body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = text;
  body.appendChild(pre);
  setStale(false);
}

toggle.addEventListener("click", () => {
  if (toggle.dataset.mode === "pretty") showRaw(lastRaw);
  else if (lastIndex) showPretty(lastIndex, lastRaw);
});

export function showError(stderr) {
  lastIndex = null;
  body.innerHTML = "";
  const div = document.createElement("div");
  div.className = "err-text";
  div.textContent = stderr;
  body.appendChild(div);
  setStale(false);
}

export function setStale(on) {
  body.classList.toggle("stale", on);
}
