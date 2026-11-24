// Build one self-contained dist/ (works from any sub path, e.g. GitHub Pages /AtomMap/).
//
//   1. engine bundle        scripts/build_engine_bundle.py  -> web/engine/
//   2. pyodide 0.27.7       scripts/fetch_pyodide.py        -> pyodide/ (downloads once, build time only)
//   3. worker               tsc in worker/                  -> worker/dist/worker.js
//   4. typecheck + vite     tsc --noEmit, vite build        -> web/dist/
//   5. copy into dist/      worker.js, engine/, wheels/, pyodide/, fixtures/
//
// No new dependencies. Python launcher: `py -3` first (the `python` command on
// Windows can be the Microsoft Store stub), then `python3`, then `python`.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const dist = join(web, "dist");

function run(cmd, args, cwd) {
  console.log(`\n> ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.error(`build failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status || 1);
  }
}

function findPython() {
  for (const cmd of [["py", "-3"], ["python3"], ["python"]]) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), "--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0 && /^Python 3/.test(`${r.stdout}${r.stderr}`.trim())) return cmd;
  }
  console.error("build failed: no Python 3 found (tried py -3, python3, python)");
  process.exit(1);
}

function bin(pkgDir, rel) {
  const p = join(pkgDir, "node_modules", rel);
  if (!existsSync(p)) {
    console.error(`build failed: ${p} not found. Run npm install in ${pkgDir}.`);
    process.exit(1);
  }
  return p;
}

const py = findPython();
const node = process.execPath;
run(py[0], [...py.slice(1), "scripts/build_engine_bundle.py"], repo);
run(py[0], [...py.slice(1), "scripts/fetch_pyodide.py"], repo);
run(node, [bin(join(repo, "worker"), "typescript/bin/tsc"), "-p", "."], join(repo, "worker"));
run(node, [bin(web, "typescript/bin/tsc"), "-p", ".", "--noEmit"], web);
run(node, [bin(web, "vite/bin/vite.js"), "build"], web);

function copy(from, to, filter) {
  if (!existsSync(from)) {
    console.error(`build failed: ${from} is missing`);
    process.exit(1);
  }
  cpSync(from, join(dist, to), { recursive: true, filter });
  console.log(`copied ${from} -> dist/${to}`);
}

mkdirSync(dist, { recursive: true });
// Worker: stable name, classic script.
copy(join(repo, "worker", "dist", "worker.js"), "worker.js");
copy(join(repo, "worker", "dist", "worker.js.map"), "worker.js.map");
copy(join(web, "engine"), "engine");
// Wheels: manifest and the pinned wheels only.
copy(join(repo, "wheels"), "wheels", (src) => statSync(src).isDirectory() || /\.(whl|json)$/.test(src));
copy(join(repo, "pyodide"), "pyodide");
// Fixtures: data files only (not the generator script).
copy(join(repo, "fixtures"), "fixtures", (src) => statSync(src).isDirectory() || src.endsWith(".json"));

const fx = readdirSync(join(dist, "fixtures"));
console.log(`\nfixtures in dist: ${fx.join(", ") || "(none)"}`);
for (const need of ["place_kadikoy.json"]) {
  if (!fx.includes(need)) console.warn(`WARNING: fixtures/${need} does not exist yet (made by scripts/fetch_place.py, task 6)`);
}
