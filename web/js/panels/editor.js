const input = document.getElementById("ruby-input");
const overlay = document.getElementById("ruby-overlay");
const tooltip = document.getElementById("hover-tooltip");

let hoverCb = null;
const editCallbacks = [];

export function renderOverlay() {
  overlay.innerHTML = "";
  const frag = document.createDocumentFragment();
  const text = input.value;
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement("span");
    span.dataset.ci = String(i);
    span.textContent = text[i];
    frag.appendChild(span);
  }
  overlay.appendChild(frag);
}

export function highlightRange([start, end]) {
  clearHighlight();
  for (let i = start; i < end; i++) {
    overlay.querySelector(`span[data-ci="${i}"]`)?.classList.add("hl");
  }
}

export function clearHighlight() {
  for (const el of overlay.querySelectorAll(".hl")) el.classList.remove("hl");
}

export function showTooltip(charIndex, text) {
  const anchor = overlay.querySelector(`span[data-ci="${charIndex}"]`);
  if (!anchor) return;
  tooltip.textContent = text;
  tooltip.hidden = false;
  const base = overlay.getBoundingClientRect();
  const r = anchor.getBoundingClientRect();
  tooltip.style.left = `${r.left - base.left}px`;
  tooltip.style.top = `${r.bottom - base.top + 4}px`;
}

export function hideTooltip() {
  tooltip.hidden = true;
}

export function onHoverChar(cb) {
  hoverCb = cb;
}

overlay.addEventListener("mouseover", (e) => {
  const ci = e.target?.dataset?.ci;
  if (ci != null && hoverCb) hoverCb(parseInt(ci, 10));
});
overlay.addEventListener("mouseleave", () => {
  clearHighlight();
  hideTooltip();
  if (hoverCb) hoverCb(null);
});
overlay.addEventListener("click", () => input.focus());

input.addEventListener("focus", () => input.classList.add("editing"));
input.addEventListener("blur", () => input.classList.remove("editing"));
input.addEventListener("scroll", () => {
  overlay.scrollTop = input.scrollTop;
  overlay.scrollLeft = input.scrollLeft;
});
input.addEventListener("input", () => {
  renderOverlay();
  for (const cb of editCallbacks) cb();
});

export function getValue() { return input.value; }
export function setValue(v) { input.value = v; renderOverlay(); }
export function onEdit(cb) { editCallbacks.push(cb); }
