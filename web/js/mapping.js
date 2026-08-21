// Pure parsing/mapping functions for spinel's intermediate artifacts.
// No DOM access — unit-tested under `node --test`.

export function parseAst(text) {
  const nodes = new Map();
  let rootId = 0;
  const lines = text.split("\n");
  lines.forEach((line, rawLine) => {
    if (!line) return;
    const sp1 = line.indexOf(" ");
    const tag = line.slice(0, sp1 < 0 ? line.length : sp1);
    if (tag === "ROOT") {
      rootId = parseInt(line.slice(5), 10);
      return;
    }
    const parts = line.split(" ");
    const id = parseInt(parts[1], 10);
    if (tag === "N") {
      nodes.set(id, { id, type: parts[2], fields: [], childIds: [], rawLine });
      return;
    }
    const node = nodes.get(id);
    if (!node) return;
    const key = parts[2];
    const payload = parts.slice(3).join(" ");
    if (tag === "S" || tag === "I" || tag === "F") {
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
  return { rootId, nodes };
}

export function parseLoc(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [id, start, end] = line.split(" ").map(Number);
    map.set(id, [start, end]);
  }
  return map;
}

const pctDecode = (s) =>
  s.replace(/%(25|20|0A|0D|09|7C)/g, (m) =>
    ({ "%25": "%", "%20": " ", "%0A": "\n", "%0D": "\r", "%09": "\t", "%7C": "|" })[m],
  );

function saEntries(records, name) {
  const rec = records.get(name);
  if (!rec) return [];
  const { count, body } = rec;
  if (count === 0) return [];
  const parts = body.split("|");
  while (parts.length < count) parts.push("");
  return parts.slice(0, count).map(pctDecode);
}

export function parseIr(text) {
  const records = new Map();
  const nodeTypes = new Map();
  for (const line of text.split("\n")) {
    if (!line || line === "SPINEL-IR v1") continue;
    const parts = line.split(" ");
    const tag = parts[0];
    if (tag === "T") {
      nodeTypes.set(parseInt(parts[1], 10), pctDecode(parts.slice(2).join(" ")));
    } else if (tag === "SA" || tag === "IA") {
      records.set(parts[1], { count: parseInt(parts[2], 10), body: parts.slice(3).join(" ") });
    }
  }
  const zipParams = (namesCsv, typesCsv) => {
    const names = namesCsv ? namesCsv.split(",") : [];
    const types = typesCsv ? typesCsv.split(",") : [];
    return names.filter((n) => n !== "").map((name, i) => ({ name, type: types[i] ?? "?" }));
  };
  const methods = saEntries(records, "@meth_names").map((name, i) => ({
    name,
    params: zipParams(saEntries(records, "@meth_param_names")[i], saEntries(records, "@meth_param_types")[i]),
    ret: saEntries(records, "@meth_return_types")[i] ?? "?",
  }));
  const classes = saEntries(records, "@cls_names").map((name, i) => {
    const ivarNames = (saEntries(records, "@cls_ivar_names")[i] || "").split(";").filter(Boolean);
    const ivarTypes = (saEntries(records, "@cls_ivar_types")[i] || "").split(";");
    const methNames = (saEntries(records, "@cls_meth_names")[i] || "").split(";").filter(Boolean);
    // per-class method params/ptypes: methods joined by (escaped) "|", params by ","
    const methParams = (saEntries(records, "@cls_meth_params")[i] || "").split("|");
    const methPtypes = (saEntries(records, "@cls_meth_ptypes")[i] || "").split("|");
    const methRets = (saEntries(records, "@cls_meth_returns")[i] || "").split(";");
    return {
      name,
      ivars: ivarNames.map((n, j) => ({ name: n, type: ivarTypes[j] ?? "?" })),
      methods: methNames.map((n, j) => ({
        name: n,
        params: zipParams(methParams[j], methPtypes[j]),
        ret: methRets[j] ?? "?",
      })),
    };
  });
  return { nodeTypes, methods, classes };
}

// ClassNode carries no "name" field of its own — the class name lives on its
// constant_path child (typically a ConstantReadNode with an S "name" field).
// Verified against test/golden/expected/class_ivar/out.ast:
//   N 2 ClassNode / N 3 ConstantReadNode / S 3 name Counter / R 2 constant_path 3
export function classNameOf(ast, node) {
  for (const childId of node.childIds) {
    const child = ast.nodes.get(childId);
    const nameField = child?.fields.find(([k]) => k === "name");
    if (nameField) return nameField[1];
  }
  return undefined;
}

function findMethodRubyRanges(ast, loc, toChar) {
  // DefNode → method. Enclosing ClassNode (if any) gives the class name.
  const result = new Map(); // methodKey -> {label, rubyRange, cName}
  const walk = (id, cls) => {
    const node = ast.nodes.get(id);
    if (!node) return;
    let nextCls = cls;
    if (node.type === "ClassNode") {
      nextCls = classNameOf(ast, node) ?? cls;
    }
    if (node.type === "DefNode") {
      const name = node.fields.find(([k]) => k === "name")?.[1];
      if (name) {
        const key = nextCls ? `${nextCls}#${name}` : name;
        const cBase = name === "initialize" && nextCls ? "new" : name;
        const cName = nextCls ? `sp_${nextCls}_${cBase}` : `sp_${name}`;
        const range = loc.get(id);
        result.set(key, {
          label: key,
          rubyRange: range ? [toChar(range[0]), toChar(range[1])] : null,
          cName,
          defId: id,
        });
      }
    }
    for (const child of node.childIds) walk(child, nextCls);
  };
  walk(ast.rootId, null);
  return result;
}

function findCFunctionRanges(cText, cNames) {
  const lines = cText.split("\n");
  const found = new Map(); // cName -> [startLine, endLine]
  lines.forEach((line, i) => {
    if (line.endsWith(";")) return; // prototype
    for (const cName of cNames) {
      if (found.has(cName)) continue;
      if (line.includes(`${cName}(`) && /^[A-Za-z_].*\{\s*$|^static\b|^int\b|^void\b/.test(line)) {
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j] === "}") { end = j; break; }
        }
        found.set(cName, [i, end]);
      }
    }
  });
  return found;
}

export function buildIndex({ source, astText, locText, irText, cText }) {
  const ast = parseAst(astText);
  const loc = parseLoc(locText);
  const ir = parseIr(irText);
  const toChar = byteToCharIndex(source);

  const byNode = new Map();
  for (const [id, node] of ast.nodes) {
    const range = loc.get(id);
    byNode.set(id, {
      range: range ? [toChar(range[0]), toChar(range[1])] : null,
      type: ir.nodeTypes.get(id) ?? null,
      astRawLine: node.rawLine,
    });
  }

  const methodDefs = findMethodRubyRanges(ast, loc, toChar);
  const cRanges = findCFunctionRanges(cText, [...methodDefs.values()].map((m) => m.cName));
  const methods = new Map();
  for (const [key, def] of methodDefs) {
    methods.set(key, {
      label: def.label,
      rubyRange: def.rubyRange,
      cRange: cRanges.get(def.cName) ?? null,
      defId: def.defId,
    });
  }
  return { byNode, methods, ast, ir };
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
