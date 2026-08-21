export async function compileRun(cSource) {
  try {
    const res = await fetch("/api/compile_run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ c_source: cSource }),
    });
    const body = await res.json();
    if (!res.ok) return { networkError: false, apiError: body.error || `HTTP ${res.status}` };
    return body;
  } catch (e) {
    return { networkError: true, message: "サーバーに接続できません(C 生成までの結果は保持されています)" };
  }
}
