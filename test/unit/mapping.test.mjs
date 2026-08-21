import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAst, parseLoc, parseIr, byteToCharIndex, buildIndex } from "../../web/js/mapping.js";

const exp = (name, file) => readFileSync(new URL(`../golden/expected/${name}/${file}`, import.meta.url), "utf8");

const fixture = (name) => ({
  source: exp(name, "loc.txt.src"),
  astText: exp(name, "out.ast"),
  locText: exp(name, "loc.txt"),
  irText: exp(name, "out.ir"),
  cText: exp(name, "out.c"),
});

test("parseAst builds the fib tree", () => {
  const { rootId, nodes } = parseAst(exp("fib", "out.ast"));
  assert.equal(rootId, 0);
  assert.equal(nodes.get(0).type, "ProgramNode");
  const def = [...nodes.values()].find((n) => n.type === "DefNode");
  assert.equal(def.fields.find(([k]) => k === "name")[1], "fib");
  assert.ok(def.childIds.length > 0);
});

test("parseLoc maps fib node 0 to the whole program", () => {
  const loc = parseLoc(exp("fib", "loc.txt"));
  const [start] = loc.get(0);
  assert.equal(start, 0);
  assert.ok(loc.get(0)[1] > 80);
});

test("parseIr extracts node types and the toplevel method table", () => {
  const ir = parseIr(exp("fib", "out.ir"));
  assert.equal(ir.nodeTypes.get(7), "bool");
  assert.equal(ir.methods.length, 1);
  assert.deepEqual(ir.methods[0], { name: "fib", params: [{ name: "n", type: "int" }], ret: "int" });
});

test("parseIr extracts class tables (class_ivar)", () => {
  const ir = parseIr(exp("class_ivar", "out.ir"));
  const counter = ir.classes.find((c) => c.name === "Counter");
  assert.deepEqual(counter.ivars, [{ name: "@count", type: "int" }]);
  assert.deepEqual(counter.methods.map((m) => m.name), ["initialize", "increment", "count"]);
  assert.deepEqual(counter.methods[0].params, [{ name: "start", type: "int" }]);
  assert.equal(counter.methods[1].ret, "int");
});

test("byteToCharIndex handles multibyte text", () => {
  const toChar = byteToCharIndex("あa");
  assert.equal(toChar(0), 0);
  assert.equal(toChar(3), 1);
  assert.equal(toChar(4), 2);
});

test("byteToCharIndex returns UTF-16 indices for astral chars", () => {
  const toChar = byteToCharIndex("🎉a");
  assert.equal(toChar(0), 0);
  assert.equal(toChar(4), 2); // "a" starts at byte 4, UTF-16 index 2
  assert.equal(toChar(5), 3); // end of string
});

test("buildIndex links fib's comparison node across panes", () => {
  const idx = buildIndex(fixture("fib"));
  const cmp = idx.byNode.get(7); // CallNode "<" (n < 2)
  assert.equal(cmp.type, "bool");
  const [s, e] = cmp.range;
  assert.equal(idx.ast.nodes.get(7).type, "CallNode");
  assert.equal(fixture("fib").source.slice(s, e), "n < 2");
});

test("buildIndex maps toplevel method to its C function", () => {
  const idx = buildIndex(fixture("fib"));
  const fib = idx.methods.get("fib");
  assert.ok(fib.cRange, "sp_fib should be found in C");
  const cLines = fixture("fib").cText.split("\n");
  assert.match(cLines[fib.cRange[0]], /sp_fib\(/);
  assert.equal(cLines[fib.cRange[1]], "}");
});

test("buildIndex maps class methods to their C functions, including the initialize->new rename", () => {
  const idx = buildIndex(fixture("class_ivar"));
  const init = idx.methods.get("Counter#initialize");
  assert.ok(init.cRange, "sp_Counter_new should be found");
  const inc = idx.methods.get("Counter#increment");
  // DEVIATION from the task-9 brief: the brief expected sp_Counter_increment to be
  // absent from C (inlined/DCE'd, cRange: null). Verified against the actual fixture
  // (test/golden/expected/class_ivar/out.c lines 40-46, 1-indexed) that this is a full
  // standalone `static inline mrb_int sp_Counter_increment(sp_Counter *self) { ... }`
  // definition, called plainly from main() as `sp_Counter_increment(lv_c);` (line 63) —
  // not textually inlined at the call site, not dead-code-eliminated. None of the other
  // golden fixtures (fib, exception, string_each, block_yield) define classes either, so
  // no fixture in the current golden set exercises a genuinely C-absent class method.
  // Asserting the verified truth instead of the brief's unverified premise. See
  // .superpowers/sdd/p2-task-9-report.md for the full investigation.
  assert.ok(inc.cRange, "sp_Counter_increment is present as a real function in this fixture's C output");
  assert.ok(inc.rubyRange);
});

test("buildIndex leaves synthetic nodes rangeless (block_yield)", () => {
  const idx = buildIndex(fixture("block_yield"));
  const rangeless = [...idx.byNode.values()].filter((n) => n.range === null);
  assert.ok(rangeless.length >= 1);
});

test("buildIndex tolerates a method absent from the generated C", () => {
  const f = fixture("fib");
  const idx = buildIndex({ ...f, cText: "/* stripped build */\nint main(void){return 0;}\n" });
  const fib = idx.methods.get("fib");
  assert.ok(fib.rubyRange, "ruby side still mapped");
  assert.equal(fib.cRange, null); // absent from C — tolerated, not an error
});
