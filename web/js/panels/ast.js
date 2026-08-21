const body = document.querySelector("#pane-ast .pane-body");
const toggle = document.querySelector("#pane-ast .pane-toggle");

let lastIndex = null;
let lastRaw = "";

const REPRESENTATIVE_KEYS = ["name", "value", "operator"];

function labelFor(node) {
  const rep = REPRESENTATIVE_KEYS.map((k) => node.fields.find(([key]) => key === k))
    .find(Boolean);
  return rep ? `${node.type} "${rep[1]}"` : node.type;
}

function renderNode(index, id) {
  const node = index.ast.nodes.get(id);
  if (!node) return null;
  const label = document.createElement("span");
  label.className = "ast-node";
  label.dataset.nodeId = String(id);
  label.textContent = labelFor(node);
  const type = index.byNode.get(id)?.type;
  if (type) {
    const t = document.createElement("span");
    t.className = "dim";
    t.textContent = ` : ${type}`;
    label.appendChild(t);
  }
  if (node.childIds.length === 0) {
    const leaf = document.createElement("div");
    leaf.className = "ast-leaf";
    leaf.appendChild(label);
    return leaf;
  }
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.appendChild(label);
  details.appendChild(summary);
  const kids = document.createElement("div");
  kids.className = "ast-children";
  for (const childId of node.childIds) {
    const el = renderNode(index, childId);
    if (el) kids.appendChild(el);
  }
  details.appendChild(kids);
  return details;
}

export function showTree(index, rawText) {
  lastIndex = index;
  lastRaw = rawText;
  toggle.dataset.mode = "tree";
  toggle.textContent = "生テキスト";
  body.innerHTML = "";
  body.appendChild(renderNode(index, index.ast.rootId));
  setStale(false);
}

export function showRaw(text) {
  lastRaw = text;
  toggle.dataset.mode = "raw";
  toggle.textContent = "ツリー表示";
  body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = text;
  body.appendChild(pre);
  setStale(false);
}

toggle.addEventListener("click", () => {
  if (toggle.dataset.mode === "tree") showRaw(lastRaw);
  else if (lastIndex) showTree(lastIndex, lastRaw);
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
