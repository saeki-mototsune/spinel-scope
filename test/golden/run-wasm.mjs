// Runs the wasm spinel the way the Worker does and writes its artifacts.
// usage: node run-wasm.mjs <spinel.mjs> <in.rb> <outdir>
//   -> <outdir>/out.ast, types.json, symbols.json, out.c, exit.txt, stderr.txt
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSpinel, parseRun, compileRun } from "../../web/js/spinel-runner.js";

const [modulePath, rbPath, outDir] = process.argv.slice(2);
const factory = (await import(pathToFileURL(resolve(modulePath)).href)).default;
const source = readFileSync(rbPath, "utf8");
mkdirSync(outDir, { recursive: true });

const parse = await runSpinel(factory, parseRun(source));
if (parse.code !== 0) {
  process.stderr.write(parse.stderr);
  process.exit(1);
}
writeFileSync(`${outDir}/out.ast`, parse.stdout);

const compile = await runSpinel(factory, compileRun(source));
writeFileSync(`${outDir}/out.c`, compile.stdout);
writeFileSync(`${outDir}/stderr.txt`, compile.stderr);
for (const [name, text] of Object.entries(compile.files)) writeFileSync(`${outDir}/${name}`, text);
process.exit(compile.code === 0 ? 0 : 2);
