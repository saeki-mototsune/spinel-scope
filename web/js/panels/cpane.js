const body = document.querySelector("#pane-c .pane-body");

export function showCode(index, cText) {
  body.innerHTML = "";
  const pre = document.createElement("pre");
  const lines = cText.split("\n");
  const lineMeta = new Map(); // line -> methodKey
  for (const [key, m] of index.methods) {
    if (!m.cRange) continue;
    for (let i = m.cRange[0]; i <= m.cRange[1]; i++) lineMeta.set(i, key);
  }
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "c-line";
    div.dataset.line = String(i);
    const key = lineMeta.get(i);
    if (key != null) {
      div.dataset.methodKey = key;
      if (index.methods.get(key).cRange[0] === i) div.classList.add("c-method");
    }
    div.textContent = line === "" ? " " : line;
    pre.appendChild(div);
  });
  body.appendChild(pre);
  setStale(false);
}

export function showRaw(text) {
  body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.textContent = text;
  body.appendChild(pre);
  setStale(false);
}

export function showError(stderr) {
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
