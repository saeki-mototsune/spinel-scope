// The generated C. The code view hides spinel's `#line N "main.rb"`
// directives and instead tags each line with the Ruby line it came from
// (data-ruby-line) and, inside a user method's C function, the method
// (data-method-key). The raw view is the C exactly as spinel emitted it.
const body = document.querySelector("#pane-c .pane-body");
const toggle = document.querySelector("#pane-c .pane-toggle");

let lastIndex = null;
let lastRaw = "";
let linesByRubyLine = new Map(); // ruby line -> [.c-line elements]

export function showCode(index, cText) {
  lastIndex = index;
  lastRaw = cText;
  toggle.dataset.mode = "code";
  toggle.textContent = "#line 込み";
  body.innerHTML = "";
  linesByRubyLine = new Map();
  const pre = document.createElement("pre");
  const { lines, rubyLineOf, isDirective } = index.cMap;
  const methodOf = new Map(); // C line -> methodKey
  const headers = new Set();
  for (const [key, m] of index.methods) {
    if (!m.cRange) continue;
    headers.add(m.cRange[0]);
    for (let i = m.cRange[0]; i <= m.cRange[1]; i++) methodOf.set(i, key);
  }
  lines.forEach((line, i) => {
    if (isDirective[i]) return;
    const div = document.createElement("div");
    div.className = "c-line";
    div.dataset.line = String(i);
    const key = methodOf.get(i);
    if (key != null) {
      div.dataset.methodKey = key;
      if (headers.has(i)) div.classList.add("c-method");
    }
    const rl = rubyLineOf[i];
    if (rl != null) {
      div.dataset.rubyLine = String(rl);
      if (!linesByRubyLine.has(rl)) linesByRubyLine.set(rl, []);
      linesByRubyLine.get(rl).push(div);
    }
    div.textContent = line === "" ? " " : line;
    pre.appendChild(div);
  });
  body.appendChild(pre);
  setStale(false);
}

// Highlights the C that came from Ruby lines [from, to]. `reveal` scrolls
// the first of it into view -- for a hover in another pane, where the user's
// code sits hundreds of lines below the runtime prelude.
export function highlightRubyLines(from, to, { reveal = false } = {}) {
  let first = null;
  for (let l = from; l <= to; l++) {
    for (const div of linesByRubyLine.get(l) ?? []) {
      div.classList.add("hl");
      if (!first || Number(div.dataset.line) < Number(first.dataset.line)) first = div;
    }
  }
  if (reveal && first) first.scrollIntoView({ block: "nearest" });
}

export function showRaw(text) {
  lastRaw = text;
  toggle.dataset.mode = "raw";
  toggle.textContent = "コード表示";
  body.innerHTML = "";
  linesByRubyLine = new Map();
  const pre = document.createElement("pre");
  pre.textContent = text;
  body.appendChild(pre);
  setStale(false);
}

toggle.addEventListener("click", () => {
  if (toggle.dataset.mode === "code") showRaw(lastRaw);
  else if (lastIndex) showCode(lastIndex, lastRaw);
});

export function showError(stderr) {
  lastIndex = null;
  linesByRubyLine = new Map();
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
