import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseAst, parseTypes, parseSymbols, parseCLineMap, findCFunctionRanges,
  byteToCharIndex, positionToCharIndex, buildIndex, methodKeyOf, typeLabel,
} from "../../web/js/mapping.js";

const exp = (name, file) => readFileSync(new URL(`../golden/expected/${name}/${file}`, import.meta.url), "utf8");
const sample = (name) => readFileSync(new URL(`../golden/samples/${name}.rb`, import.meta.url), "utf8");

const fixture = (name) => ({
  source: sample(name),
  sourceName: "main.rb",
  astText: exp(name, "out.ast"),
  typesJson: exp(name, "types.json"),
  symbolsJson: exp(name, "symbols.json"),
  cText: exp(name, "out.c"),
});

const slice = (f, range) => f.source.slice(range[0], range[1]);

test("parseAst builds the fib tree with node spans", () => {
  const { rootId, nodes, files } = parseAst(exp("fib", "out.ast"));
  assert.equal(rootId, 0);
  assert.equal(files.get(0), "main.rb");
  assert.equal(nodes.get(0).type, "ProgramNode");
  const def = [...nodes.values()].find((n) => n.type === "DefNode");
  assert.equal(def.fields.find(([k]) => k === "name")[1], "fib");
  assert.deepEqual([def.line, def.col, def.endLine, def.endCol], [1, 0, 7, 3]);
  assert.ok(def.childIds.length > 0);
  // position attributes are not display fields
  assert.ok(!def.fields.some(([k]) => k.startsWith("node_")));
});

test("parseAst attributes spliced builtins to their own files", () => {
  const { nodes, files } = parseAst(exp("class_ivar", "out.ast"));
  assert.equal(files.get(0), "main.rb");
  assert.match(files.get(1), /builtins.*enumera/);
  assert.ok([...nodes.values()].some((n) => n.file !== 0));
});

test("parseTypes / parseSymbols read the JSON and survive a missing file", () => {
  const t = parseTypes(exp("fib", "types.json"));
  assert.ok(t.types.some((r) => r.kind === "DefNode" && r.signature === "(Integer) -> Integer"));
  assert.ok(t.codegen.some((r) => r.callee === "fib"));
  assert.deepEqual(parseTypes(""), { types: [], diagnostics: [], codegen: [] });
  assert.deepEqual(parseSymbols(exp("fib", "symbols.json")).map((s) => s.c), ["sp_fib"]);
  assert.deepEqual(parseSymbols("{"), []);
});

test("parseCLineMap follows #line directives for the source file only", () => {
  const { lines, rubyLineOf, isDirective } = parseCLineMap(exp("fib", "out.c"), "main.rb");
  const rec = lines.findIndex((l) => l.includes("sp_fib(sp_int_sub(lv_n, 1LL))"));
  assert.ok(rec > 0);
  assert.equal(rubyLineOf[rec], 5);
  const dir = lines.findIndex((l) => l.startsWith("#line "));
  assert.ok(isDirective[dir]);
  assert.equal(rubyLineOf[dir], null);
  const synth = parseCLineMap('#line 1 "<spinel-synthesized>"\nint x;\n', "main.rb");
  assert.equal(synth.rubyLineOf[1], null);
});

test("findCFunctionRanges finds a definition, not its prototype", () => {
  const c = exp("fib", "out.c");
  const lines = c.split("\n");
  const r = findCFunctionRanges(c, ["sp_fib"]).get("sp_fib");
  assert.ok(r, "sp_fib should be found in C");
  assert.match(lines[r[0]], /sp_fib\(.*\{\s*$/);
  assert.equal(lines[r[1]], "}");
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

test("positionToCharIndex maps (line, byte col) and rejects positions past the text", () => {
  const at = positionToCharIndex("あい\nx = 1\n");
  assert.equal(at(1, 3), 1); // after "あ"
  assert.equal(at(2, 0), 3);
  assert.equal(at(2, 4), 7);
  assert.equal(at(9, 0), null);
});

test("methodKeyOf / typeLabel", () => {
  assert.equal(methodKeyOf({ name: "fib", owner: "Object" }), "fib");
  assert.equal(methodKeyOf({ name: "inc", owner: "Counter" }), "Counter#inc");
  assert.equal(methodKeyOf({ name: "make", owner: "P", singleton: true }), "P.make");
  assert.equal(typeLabel({ type: "int", rbs: "Integer" }), "Integer (int)");
  assert.equal(typeLabel({ type: "nil", rbs: "nil" }), "nil");
});

test("buildIndex links fib's comparison node across panes", () => {
  const f = fixture("fib");
  const idx = buildIndex(f);
  assert.equal(idx.positionsMatchSource, true);
  const cmp = idx.byNode.get(7); // CallNode "<" (n < 2)
  assert.equal(idx.ast.nodes.get(7).type, "CallNode");
  assert.equal(slice(f, cmp.range), "n < 2");
  assert.equal(cmp.type, "bool");
  const dispatch = idx.codegen.find((r) => r.nodeId === 7);
  assert.equal(dispatch.dispatch, "direct");
});

test("buildIndex maps a toplevel method to its C function via the symbol map", () => {
  const f = fixture("fib");
  const idx = buildIndex(f);
  const fib = idx.methods.get("fib");
  assert.equal(fib.signature, "(Integer) -> Integer");
  assert.equal(fib.cName, "sp_fib");
  assert.match(slice(f, fib.rubyRange), /^def fib\(n\)[\s\S]*end$/);
  const cLines = f.cText.split("\n");
  assert.match(cLines[fib.cRange[0]], /sp_fib\(/);
  assert.equal(cLines[fib.cRange[1]], "}");
  assert.equal(idx.byNode.get(fib.defId).typeRec.kind, "DefNode");
});

// Regression for patches/0001: spliced builtins (3.times pulls in
// enumerable.rb and enumerator.rb) must not shift the program's positions.
test("buildIndex keeps class_ivar positions exact despite spliced builtins", () => {
  const f = fixture("class_ivar");
  const idx = buildIndex(f);
  assert.equal(idx.positionsMatchSource, true);
  const init = idx.methods.get("Counter#initialize");
  assert.match(slice(f, init.rubyRange), /^def initialize\(start\)/);
  assert.equal(init.cName, "sp_Counter_initialize");
  assert.ok(init.cRange, "sp_Counter_initialize should be found in C");
  const inc = idx.methods.get("Counter#increment");
  assert.equal(inc.signature, "() -> Integer");
  // an always_inline method: `static inline __attribute__((always_inline)) ...`
  assert.match(f.cText.split("\n")[inc.cRange[0]], /always_inline.*sp_Counter_increment\(/);
  const ivar = idx.typeRecords.find((r) => r.kind === "InstanceVariableWriteNode");
  assert.equal(slice(f, ivar.range), "@count = start");
  // tree view: the root stays (it contains the program), builtins-only
  // subtrees do not
  assert.ok(idx.userSubtree.has(idx.ast.rootId));
  const builtinsOnly = [...idx.ast.nodes.values()].filter((n) => n.file !== 0 && !idx.userSubtree.has(n.id));
  assert.ok(builtinsOnly.length > 1000);
});

test("buildIndex resolves multibyte spans (nihongo)", () => {
  const f = fixture("nihongo");
  const idx = buildIndex(f);
  const strings = idx.typeRecords.filter((r) => r.kind === "StringNode").map((r) => slice(f, r.range));
  assert.ok(strings.includes('"こんにちは"'), strings.join(" / "));
});

test("buildIndex unmaps only the lines spinel rewrote (&:sym)", () => {
  const source = 'x = 1\nputs [1, 2, 3].map(&:to_s).join(",")\nputs x\n';
  // what spinel reports for it: line 2 is the rewritten `map { |_spx| _spx.to_s }`
  const astText = [
    "ROOT 0", "FILE 0 main.rb",
    "I 0 node_line 1", "I 0 node_col 0", "I 0 node_end_line 3", "I 0 node_end_col 6", "N 0 ProgramNode",
    "I 1 node_line 1", "I 1 node_col 0", "I 1 node_end_line 1", "I 1 node_end_col 5", "N 1 LocalVariableWriteNode",
    "I 2 node_line 2", "I 2 node_col 5", "I 2 node_end_line 2", "I 2 node_end_col 39", "N 2 CallNode",
    "I 3 node_line 3", "I 3 node_col 5", "I 3 node_end_line 3", "I 3 node_end_col 6", "N 3 LocalVariableReadNode",
    "A 0 body 1,2,3",
  ].join("\n");
  const idx = buildIndex({ source, sourceName: "main.rb", astText, typesJson: "", symbolsJson: "", cText: "" });
  assert.equal(idx.positionsMatchSource, true);
  assert.deepEqual(idx.rewrittenLines, [2]);
  assert.equal(source.slice(...idx.byNode.get(1).range), "x = 1");
  assert.equal(idx.byNode.get(2).range, null);
  assert.equal(source.slice(...idx.byNode.get(3).range), "x");
  assert.ok(idx.byNode.get(0).range, "a node spanning the line from outside keeps its range");
});

test("positionToCharIndex rejects a column past its line", () => {
  const at = positionToCharIndex("ab\ncd");
  assert.equal(at(1, 2), 2);
  assert.equal(at(1, 3), null);
  assert.equal(at(2, 2), 5);
  assert.equal(at(2, 3), null);
});

test("buildIndex switches Ruby mapping off when positions run past the source", () => {
  const f = fixture("fib");
  const idx = buildIndex({ ...f, source: "def fib(n)\n" });
  assert.equal(idx.positionsMatchSource, false);
});

test("buildIndex tolerates a method absent from the generated C", () => {
  const f = fixture("fib");
  const idx = buildIndex({ ...f, cText: "/* stripped build */\nint main(void){return 0;}\n" });
  const fib = idx.methods.get("fib");
  assert.ok(fib.rubyRange, "ruby side still mapped");
  assert.equal(fib.cRange, null); // absent from C — tolerated, not an error
});

test("buildIndex gives a start-only refusal the rest of its line", () => {
  const source = "x = 1\nputs @@count\n";
  const idx = buildIndex({
    source, sourceName: "main.rb", astText: "ROOT 0\nFILE 0 main.rb\nN 0 ProgramNode\n", symbolsJson: "", cText: "",
    typesJson: JSON.stringify({ types: [], codegen: [], diagnostics: [
      { file: "main.rb", line: 2, col: 0, severity: "error", message: "unsupported puts argument" },
      { file: "/spinel/builtins/enumerable.rb", line: 3, col: 0, severity: "warning", message: "widened" },
    ] }),
  });
  assert.equal(idx.diagnostics.length, 1, "builtins' own diagnostics are left out");
  assert.equal(source.slice(...idx.diagnostics[0].range), "puts @@count");
});
