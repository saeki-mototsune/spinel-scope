// Usage: node run-tool.mjs <tool.mjs> <workdir> <env-json> [args...]
// Runs an emcc MODULARIZE=1 EXPORT_ES6=1 tool: stages <workdir> files into
// MEMFS /work, runs main there, then copies produced files back out.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [tool, workdir, envJson, ...args] = process.argv.slice(2);
const env = JSON.parse(envJson || '{}');
const createModule = (await import(pathToFileURL(tool).href)).default;
const mod = await createModule({
  print: (s) => process.stdout.write(s + '\n'),
  printErr: (s) => process.stderr.write(s + '\n'),
  preRun: [(m) => { Object.assign(m.ENV, env); }],
});
mod.FS.mkdir('/work');
for (const f of readdirSync(workdir)) {
  const p = join(workdir, f);
  if (statSync(p).isFile()) mod.FS.writeFile('/work/' + f, readFileSync(p));
}
mod.FS.chdir('/work');
let code = 0;
try { code = mod.callMain(args); } catch (e) { if (e?.name === 'ExitStatus') code = e.status; else throw e; }
for (const f of mod.FS.readdir('/work')) {
  if (f === '.' || f === '..') continue;
  const st = mod.FS.stat('/work/' + f);
  if (mod.FS.isFile(st.mode)) writeFileSync(join(workdir, f), mod.FS.readFile('/work/' + f));
}
process.exit(code);
