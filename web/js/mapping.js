// Pure parsing/mapping functions for spinel's outputs. No DOM access —
// unit-tested under `node --test`.
//
// Inputs (one visualization = two spinel runs, see spinel-runner.js):
//   astText     `--dump-ast` with SPINEL_EMIT_TYPES=1: every node carries its
//               file and its Prism span (node_line/node_col/node_end_*)
//   typesJson   `--emit-types`: a record per typed node + diagnostics +
//               codegen decisions, each with a span
//   symbolsJson `--emit-symbol-map`: emitted C symbol -> Ruby method name
//   cText       the C (`-S`), whose `#line N "file"` directives name the
//               Ruby line each run of C lines came from
//
// Lines are 1-based and columns 0-based byte offsets, as Prism reports them.

// Per-node position attributes the AST carries; kept off `fields`.
const POS_KEYS = new Set(["node_line", "node_col", "node_end_line", "node_end_col", "node_file"]);

export function parseAst(text) {
  const nodes = new Map();
  const files = new Map(); // file id -> path
  let rootId = 0;
  const get = (id) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, type: "?", fields: [], childIds: [], rawLine: -1, file: null, line: null, col: null, endLine: null, endCol: null };
      nodes.set(id, n);
    }
    return n;
  };
  text.split("\n").forEach((line, rawLine) => {
    if (!line) return;
    const parts = line.split(" ");
    const tag = parts[0];
    if (tag === "ROOT") { rootId = parseInt(parts[1], 10); return; }
    if (tag === "FILE") { files.set(parseInt(parts[1], 10), parts.slice(2).join(" ")); return; }
    if (tag === "SOURCE_FILE") return;
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id)) return;
    // Position attributes precede their node's `N` line, so nodes are made
    // on first mention rather than at `N`.
    const node = get(id);
    if (tag === "N") {
      node.type = parts[2];
      node.rawLine = rawLine;
      return;
    }
    const key = parts[2];
    const payload = parts.slice(3).join(" ");
    if (tag === "I" && POS_KEYS.has(key)) {
      const v = parseInt(payload, 10);
      if (key === "node_line") node.line = v;
      else if (key === "node_col") node.col = v;
      else if (key === "node_end_line") node.endLine = v;
      else if (key === "node_end_col") node.endCol = v;
      else node.file = v;
    } else if (tag === "S" || tag === "I" || tag === "F") {
      node.fields.push([key, payload]);
    } else if (tag === "R") {
      const ref = parseInt(payload, 10);
      if (ref >= 0) node.childIds.push(ref);
    } else if (tag === "A") {
      for (const tok of payload.split(",")) {
        const ref = parseInt(tok, 10);
        if (Number.isInteger(ref) && ref >= 0) node.childIds.push(ref);
      }
    }
  });
  // A node the parser synthesized has no position and no file of its own
  // (a BlockNode's implicit BlockParametersNode): it belongs to its parent's.
  const inherit = (id, file) => {
    const n = nodes.get(id);
    if (!n) return;
    if (n.file == null) n.file = file;
    for (const c of n.childIds) inherit(c, n.file);
  };
  inherit(rootId, 0);
  return { rootId, nodes, files };
}

// The types JSON may be absent (a compile that crashed before writing it) or
// cut short; treat either as "no records".
export function parseTypes(jsonText) {
  try {
    const j = JSON.parse(jsonText);
    return { types: j.types ?? [], diagnostics: j.diagnostics ?? [], codegen: j.codegen ?? [] };
  } catch {
    return { types: [], diagnostics: [], codegen: [] };
  }
}

export function parseSymbols(jsonText) {
  try {
    return JSON.parse(jsonText).symbols ?? [];
  } catch {
    return [];
  }
}

// `#line N "file"` directives -> for each C line, the Ruby line it came from
// (null for directive lines themselves, synthesized code and other files). A
// directive holds until the next one: spinel emits one before each statement,
// so the lines in between (a closing brace) belong to the same Ruby line.
export function parseCLineMap(cText, sourceName) {
  const lines = cText.split("\n");
  const rubyLineOf = new Array(lines.length).fill(null);
  const isDirective = new Array(lines.length).fill(false);
  let current = null;
  const re = /^#line (\d+) "(.*)"$/;
  lines.forEach((line, i) => {
    const m = re.exec(line);
    if (m) {
      isDirective[i] = true;
      current = m[2] === sourceName ? parseInt(m[1], 10) : null;
      return;
    }
    rubyLineOf[i] = current;
  });
  return { lines, rubyLineOf, isDirective };
}

// Finds each named C function's definition: its header line (not a
// prototype) through the closing `}` at column 0.
export function findCFunctionRanges(cText, cNames) {
  const lines = cText.split("\n");
  const wanted = new Set(cNames);
  const found = new Map(); // cName -> [startLine, endLine]
  // `static inline __attribute__((always_inline)) sp_int sp_C_m(...) {`:
  // the name is any called-looking identifier on a line opening a body
  const header = /^[A-Za-z_][^;]*\{\s*$/;
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i])) continue;
    const name = [...lines[i].matchAll(/\b([A-Za-z_]\w*)\(/g)].map((m) => m[1]).find((n) => wanted.has(n));
    if (!name || found.has(name)) continue;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === "}") { end = j; break; }
    }
    found.set(name, [i, end]);
  }
  return found;
}

// The spelling codegen's `callee`, the symbol map's `ruby` and a DefNode's
// owner/name/singleton all compose to: `fib`, `Point#dist2`, `Point.make`.
export function methodKeyOf(rec) {
  if (!rec.owner || rec.owner === "Object") return rec.name;
  return rec.singleton ? `${rec.owner}.${rec.name}` : `${rec.owner}#${rec.name}`;
}

// A type as the panes show it: RBS (the type language to read), plus
// spinel's own tag when it says more (`Integer` vs `int`).
export function typeLabel(rec) {
  if (!rec) return null;
  return rec.rbs && rec.type && rec.rbs !== rec.type ? `${rec.rbs} (${rec.type})` : (rec.rbs ?? rec.type);
}

const spanKey = (file, line, col, endLine, endCol, kind) => `${file}|${line}|${col}|${endLine}|${endCol}|${kind}`;

// (line, byte col) -> UTF-16 index into `source`; null for a position past
// its line's end (or a line past the text's).
export function positionToCharIndex(source) {
  const toChar = byteToCharIndex(source);
  const enc = new TextEncoder();
  const lineStartBytes = [0];
  let byte = 0;
  for (const cp of source) {
    byte += enc.encode(cp).length;
    if (cp === "\n") lineStartBytes.push(byte);
  }
  lineStartBytes.push(byte + 1); // sentinel: the last line ends at the text's end
  return (line, col) => {
    if (line == null || col == null || line < 1 || line >= lineStartBytes.length) return null;
    const b = lineStartBytes[line - 1] + col;
    return b >= lineStartBytes[line] ? null : toChar(b);
  };
}

// spinel rewrites some sugar in the source text before parsing it
// (rewrite_syntax_sugar in src/spinel_parse.c: `m(&:s)` -> `m { |_spx|
// _spx.s }`, `.send(:m, a)` -> `.m(a)`), always within one line. Positions
// on such a line describe the rewritten text. These are the rewrites'
// triggers; a string or comment that merely contains one only costs that
// line its mapping.
const REWRITE_TRIGGER = /&:[A-Za-z_]|\.send\(\s*[:"]/;

export function buildIndex({ source, sourceName, astText, typesJson, symbolsJson, cText }) {
  const ast = parseAst(astText);
  const types = parseTypes(typesJson);
  const symbols = parseSymbols(symbolsJson);
  const toChar = positionToCharIndex(source);
  const inSource = (rec) => rec.file === sourceName;

  // The user's file is SOURCE_FILE (file 0); spliced builtins files follow.
  // A node belongs to the file its START is in, so with builtins spliced
  // ahead of the program the ProgramNode itself is a builtins-file node.
  const userFile = [...ast.files].find(([, path]) => path === sourceName)?.[0] ?? 0;
  const userNodes = [...ast.nodes.values()].filter((n) => n.file === userFile && n.line != null && n.endLine != null);

  // Lines whose positions do not describe the text in the editor: the ones
  // spinel rewrote, and any a span runs past the end of. Nothing that starts
  // or ends on one is mapped to the Ruby side, rather than drawn in the wrong
  // place. A position past the last line means the positions describe some
  // other text altogether (positionsMatchSource: false).
  const sourceLines = source.split("\n");
  const rewrittenLines = new Set();
  sourceLines.forEach((l, i) => { if (REWRITE_TRIGGER.test(l)) rewrittenLines.add(i + 1); });
  let positionsMatchSource = true;
  for (const n of userNodes) {
    for (const [line, col] of [[n.line, n.col], [n.endLine, n.endCol]]) {
      if (toChar(line, col) != null) continue;
      if (line > sourceLines.length) positionsMatchSource = false;
      else rewrittenLines.add(line);
    }
  }
  const rangeOf = (line, col, endLine, endCol) => {
    if (rewrittenLines.has(line) || rewrittenLines.has(endLine)) return null;
    const s = toChar(line, col);
    const e = toChar(endLine, endCol);
    return s == null || e == null || e < s ? null : [s, e];
  };

  // Every user-file node's span, straight from the AST.
  const byNode = new Map();
  for (const [id, node] of ast.nodes) byNode.set(id, { range: null, type: null, typeRec: null, inSource: node.file === userFile });
  for (const node of userNodes) byNode.get(node.id).range = rangeOf(node.line, node.col, node.endLine, node.endCol);

  // Joins records to AST nodes by span and kind. The records and the AST are
  // both in node order, so a repeated key (rare: nested nodes of one kind over
  // the same span) is matched first-to-first.
  const joiner = () => {
    const queues = new Map(); // spanKey -> [node ids in order]
    for (const n of userNodes) {
      const k = spanKey(sourceName, n.line, n.col, n.endLine, n.endCol, n.type);
      if (!queues.has(k)) queues.set(k, []);
      queues.get(k).push(n.id);
    }
    return (rec) => ({
      ...rec,
      nodeId: queues.get(spanKey(rec.file, rec.line, rec.col, rec.end_line, rec.end_col, rec.kind))?.shift() ?? null,
      range: rangeOf(rec.line, rec.col, rec.end_line, rec.end_col),
    });
  };
  const typeRecords = types.types.filter(inSource).map(joiner());
  for (const rec of typeRecords) {
    if (rec.nodeId == null) continue;
    const info = byNode.get(rec.nodeId);
    info.type = typeLabel(rec);
    info.typeRec = rec;
  }
  const codegen = types.codegen.filter(inSource).map(joiner());
  // Only the program's own: the spliced builtins carry widening warnings of
  // their own (`__enumw_map`'s parameters), which say nothing about it. A
  // refusal may carry only its start; it then covers the rest of its line.
  const lineRange = lineRangeOf(source);
  const diagnostics = types.diagnostics.filter(inSource).map((d) => {
    let range = null;
    if (d.end_line != null) range = rangeOf(d.line, d.col, d.end_line, d.end_col);
    else if (lineRange(d.line)) range = [toChar(d.line, d.col) ?? lineRange(d.line)[0], lineRange(d.line)[1]];
    return { ...d, range };
  });

  // Methods: the user's DefNodes as --emit-types placed them, joined to their
  // C function through the symbol map.
  const cNameByMethod = new Map();
  for (const s of symbols) if (s.file === sourceName) cNameByMethod.set(s.ruby, s.c);
  const cRanges = findCFunctionRanges(cText, [...cNameByMethod.values()]);
  const methods = new Map();
  for (const rec of typeRecords) {
    if (rec.kind !== "DefNode") continue;
    const key = methodKeyOf(rec);
    const cName = cNameByMethod.get(key) ?? null;
    methods.set(key, {
      key,
      owner: rec.owner ?? "Object",
      name: rec.name,
      singleton: !!rec.singleton,
      signature: rec.signature ?? null,
      widened: !!rec.widened,
      rubyRange: rec.range,
      defId: rec.nodeId,
      cName,
      cRange: cName ? cRanges.get(cName) ?? null : null,
    });
  }

  const cMap = parseCLineMap(cText, sourceName);
  return {
    sourceName, ast, byNode, typeRecords, codegen, diagnostics, methods, cMap,
    positionsMatchSource, rewrittenLines: [...rewrittenLines].sort((a, b) => a - b), lineRange,
    userSubtree: userSubtree(ast, userFile),
  };
}

// The nodes a tree view of the user's program shows: user-file nodes and
// their ancestors (the ProgramNode/StatementsNode the builtins splice ahead
// of the program). A subtree wholly inside a builtins file is left out.
function userSubtree(ast, userFile) {
  const keep = new Set();
  const visit = (id) => {
    const node = ast.nodes.get(id);
    if (!node) return false;
    let any = node.file === userFile;
    for (const c of node.childIds) if (visit(c)) any = true;
    if (any) keep.add(id);
    return any;
  };
  visit(ast.rootId);
  return keep;
}

// Ruby line number (1-based) -> [start, end) UTF-16 range, without the
// newline.
function lineRangeOf(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (line) => {
    if (line < 1 || line > starts.length) return null;
    const s = starts[line - 1];
    const e = line < starts.length ? starts[line] - 1 : source.length;
    return [s, e];
  };
}

// The class a node sits in (innermost enclosing ClassNode/ModuleNode), by
// walking the tree from the root.
export function enclosingClassNames(ast, predicate) {
  const out = new Map(); // node id -> class name
  const walk = (id, cls) => {
    const node = ast.nodes.get(id);
    if (!node) return;
    let next = cls;
    if (node.type === "ClassNode" || node.type === "ModuleNode") next = classNameOf(ast, node) ?? cls;
    if (predicate(node)) out.set(id, next);
    for (const c of node.childIds) walk(c, next);
  };
  walk(ast.rootId, null);
  return out;
}

// ClassNode carries no "name" field of its own — the class name lives on its
// constant_path child (typically a ConstantReadNode with an S "name" field).
export function classNameOf(ast, node) {
  for (const childId of node.childIds) {
    const child = ast.nodes.get(childId);
    if (child?.type === "ConstantReadNode" || child?.type === "ConstantPathNode") {
      const nameField = child.fields.find(([k]) => k === "name");
      if (nameField) return nameField[1];
    }
  }
  return undefined;
}

export function byteToCharIndex(source) {
  const starts = [];
  let byte = 0;
  const enc = new TextEncoder();
  // Iterate over code points, not UTF-16 code units.
  // For each code point, push cp.length (1 or 2) duplicate byte entries into starts,
  // then advance byte counter. Returns UTF-16 code-unit index (for DOM/string slicing).
  for (const cp of source) {
    for (let i = 0; i < cp.length; i++) {
      starts.push(byte);
    }
    byte += enc.encode(cp).length;
  }
  starts.push(byte);
  return (byteOffset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= byteOffset) lo = mid;
      else hi = mid - 1;
    }
    // When there are duplicate byte values (surrogate pairs), return the first occurrence.
    while (lo > 0 && starts[lo - 1] === starts[lo]) {
      lo--;
    }
    return lo;
  };
}
