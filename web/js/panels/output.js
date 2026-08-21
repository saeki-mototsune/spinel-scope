const body = document.querySelector("#pane-output .pane-body");

export function showRunning() {
  body.innerHTML = "";
  const div = document.createElement("div");
  div.className = "dim";
  div.style.padding = "8px 10px";
  div.textContent = "コンパイル・実行中…";
  body.appendChild(div);
  setStale(false);
}

export function showResult(r) {
  body.innerHTML = "";
  // A cc_exit of -1 means "cc never reported an exit status" — that's both
  // what a real sandbox failure looks like AND what a 15s overall kill fired
  // mid-compile looks like (cc_stderr comes back empty either way). Check
  // timed_out first so the latter isn't misreported as a bare compiler
  // error with no explanation. The cc_exit === 0 case (a run-phase timeout
  // after a successful compile) already gets a timeout-aware message below.
  if (r.timed_out && r.cc_exit !== 0) {
    const div = document.createElement("div");
    div.className = "err-text";
    div.textContent = `タイムアウト(コンパイル/実行 全体で 15 秒制限)· ${r.duration_ms}ms`;
    body.appendChild(div);
    setStale(false);
    return;
  }
  if (r.cc_exit !== 0) {
    const err = document.createElement("div");
    err.className = "err-text";
    err.textContent = "cc がエラーを返しました:\n" + r.cc_stderr;
    body.appendChild(err);
    setStale(false);
    return;
  }
  const pre = document.createElement("pre");
  pre.textContent = r.stdout;
  body.appendChild(pre);
  if (r.stderr) {
    const err = document.createElement("div");
    err.className = "err-text";
    err.textContent = r.stderr;
    body.appendChild(err);
  }
  const meta = document.createElement("div");
  meta.className = "dim";
  meta.style.padding = "4px 10px";
  meta.textContent = r.timed_out
    ? `タイムアウト(実行 10 秒制限)· ${r.duration_ms}ms`
    : `exit ${r.run_exit} · ${r.duration_ms}ms · native(server)`;
  body.appendChild(meta);
  setStale(false);
}

export function showNetworkError(message) {
  body.innerHTML = "";
  const div = document.createElement("div");
  div.className = "err-text";
  div.textContent = message;
  body.appendChild(div);
  setStale(false);
}

export function setStale(on) {
  body.classList.toggle("stale", on);
}
