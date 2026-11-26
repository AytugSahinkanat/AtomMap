// Records REAL browser runs into web/public/results.json (ui spec, task 16.2).
//
//   npm run record-results                  build dist, run the 30 runs, write results.json at the end
//   npm run record-results -- --no-build    reuse an existing dist/
//   npm run record-results -- --dry-run     ONE run (Wifi hall, seed 1), print record and checks, write NOTHING
//   npm run record-results -- --check       the 30 runs again, compared with results.json, write NOTHING
//                                           (exit 0 when every run reproduces, 1 with one line per difference)
//
// Measured runs always use the defaults: a request with lab settings is refused (experience spec, Req. 17.6).
//
// The protocol is fixed in record-lib.mjs (PROTOCOL_TEXT). Summary: built dist, Chromium
// through Playwright, one worker, 30 runs one after the other (3 maps x seeds 1 to 10), app
// defaults, all four competitors per request. Requests come from the app's own buildRequest.
// Every run goes into the file. Nothing is retried, removed or replaced.
//
// results.json is written once, at the end, atomically (temp file, then rename). If the
// script stops half way, it writes nothing. No timings are written to the file.
// No new dependencies: dist is served by a small server of this script, and the harness page
// is served by this script too (it is not written into dist).

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assembleFile,
  assembleRecord,
  buildSettings,
  commitLabel,
  planRuns,
  readPyNumber,
  compareRecords,
  settingsProblem,
} from "./record-lib.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const dist = join(web, "dist");
const outFile = join(web, "public", "results.json");
const DRY = process.argv.includes("--dry-run");
const CHECK = process.argv.includes("--check");
if (DRY && CHECK) {
  console.error("Use --dry-run or --check, not both.");
  process.exit(1);
}
// --check compares with the committed file, so read it first: a missing or broken file stops here.
let committed = null;
if (CHECK) {
  try {
    committed = JSON.parse(readFileSync(outFile, "utf8"));
    if (!Array.isArray(committed.runs)) throw new Error("it has no runs list");
  } catch (e) {
    console.error(`--check needs web/public/results.json (${e.message}). Nothing was run.`);
    process.exit(1);
  }
}
const RUN_LIMIT_MS = 10 * 60 * 1000;
const LOAD_LIMIT_MS = 5 * 60 * 1000;

let browser = null;
let server = null;
let tmp = null;

async function cleanup() {
  try { await browser?.close(); } catch { /* already closed */ }
  try { server?.close(); } catch { /* already closed */ }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
async function stop(message, code = 1) {
  console.error(message);
  await cleanup();
  process.exit(code);
}
process.on("SIGINT", () => stop("\nStopped (Ctrl+C). Nothing was written.", 130));

function git(args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return r.stdout;
}

// ---- 1. engine constants, read from the engine source ----
const engineSrc = (f) => readFileSync(join(repo, "engine", "src", "atommap", f), "utf8");
const engine = {
  shots: readPyNumber(engineSrc("simulator.py"), "SHOTS"),
  steps: readPyNumber(engineSrc("simulator.py"), "STEPS"),
  tile_size: readPyNumber(engineSrc("tiles.py"), "MAX_TILE"),
  top_group_share: readPyNumber(engineSrc("loop.py"), "TOP_SHARE"),
};
console.log(`engine constants: ${JSON.stringify(engine)}`);

// ---- 2. app commit (before the build, so the build cannot change it) ----
let commit;
try {
  commit = commitLabel(git(["rev-parse", "HEAD"]), git(["status", "--porcelain"]));
} catch (e) {
  await stop(`Cannot read the git commit: ${e.message}`);
}
console.log(`app commit: ${commit}`);

// ---- 3. build ----
if (!process.argv.includes("--no-build")) {
  console.log("building dist (node scripts/build-site.mjs)");
  const r = spawnSync(process.execPath, [join(web, "scripts", "build-site.mjs")], { cwd: web, stdio: "inherit" });
  if (r.error || r.status !== 0) await stop("The build did not finish. See the output above. Nothing was written.");
}
if (!existsSync(join(dist, "index.html"))) await stop("web/dist/index.html is missing. Run without --no-build.");

// Pyodide version from the build (pyodide-lock.json of the self-hosted runtime).
let pyodide;
try {
  pyodide = JSON.parse(readFileSync(join(dist, "pyodide", "pyodide-lock.json"), "utf8")).info.version;
} catch (e) {
  await stop(`Cannot read the Pyodide version from dist/pyodide/pyodide-lock.json (${e.message}).`);
}
if (pyodide !== "0.27.7") await stop(`The build has Pyodide ${pyodide}, but it must be 0.27.7. Nothing was written.`);

// ---- 4. the app's own buildRequest, bundled into a temp dir outside src and dist ----
tmp = mkdtempSync(join(tmpdir(), "atommap-record-"));
let buildRequest;
try {
  const { build } = await import("vite");
  mkdirSync(join(tmp, "entry"));
  const entry = join(tmp, "entry", "entry.ts");
  writeFileSync(entry, `export { buildRequest } from ${JSON.stringify(join(web, "src", "screens", "map-request.ts").replaceAll("\\", "/"))};\n`);
  await build({
    root: web,
    configFile: false,
    logLevel: "warn",
    build: {
      outDir: join(tmp, "out"),
      emptyOutDir: true,
      minify: false,
      lib: { entry, formats: ["es"], fileName: () => "map-request.mjs" },
    },
  });
  ({ buildRequest } = await import(pathToFileURL(join(tmp, "out", "map-request.mjs")).href));
} catch (e) {
  await stop(`Cannot bundle web/src/screens/map-request.ts (${e.message}). Nothing was written.`);
}

// ---- 5. requests, from the committed fixtures ----
const fixture = (f) => JSON.parse(readFileSync(join(repo, "fixtures", f), "utf8"));
for (const f of ["wifi_hall_hero.json", "wifi_hall_sparse.json", "wifi_hall_walls.json", "place_kadikoy.json"]) {
  if (!existsSync(join(repo, "fixtures", f))) await stop(`fixtures/${f} is missing. Nothing was written.`);
}
const hero = fixture("wifi_hall_hero.json");
const sparse = fixture("wifi_hall_sparse.json");
const walls = fixture("wifi_hall_walls.json").walls;
const kadikoy = fixture("place_kadikoy.json");

const CHOICES = {
  "Wifi hall": { mode: "channel_plan", points: hero.points, walls, wallsOn: false, r: hero.graph.r },
  "Wifi hall, sparse control": { mode: "channel_plan", points: sparse.points, walls, wallsOn: false, r: sparse.graph.r },
  "Kadıköy, Istanbul": { mode: "place", points: kadikoy.points, walkingEdges: kadikoy.walking_edges, walking: true },
};

// ---- 6. Chromium ----
let chromium;
try {
  ({ chromium } = await import("playwright"));
  browser = await chromium.launch();
} catch (e) {
  await stop(`Chromium cannot start (${String(e.message).split("\n")[0]}). Try: npx playwright install chromium`);
}
const chromiumVersion = browser.version();
console.log(`Chromium ${chromiumVersion}`);

// ---- 7. static server: dist plus the harness page (not written into dist) ----
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".whl": "application/octet-stream", ".zip": "application/zip", ".map": "application/json",
};
// The harness only creates the worker, sends the request and returns the engine's answer.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>harness</title><script>
let worker = null, pending = null;
function settle(v) { const p = pending; pending = null; if (p) p(v); }
window.__startWorker = () => new Promise((resolve, reject) => {
  worker = new Worker(new URL("worker.js", location.href).href);
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") resolve(true);
    else if (m.type === "competitor_done" || m.type === "progress") { /* not needed */ }
    else if (m.type === "result") settle({ result: m.payload });
    else if (m.type === "error") { if (pending) settle({ error: m.payload }); else reject(new Error(m.payload.message)); }
  };
  worker.onerror = (ev) => { const e = new Error(ev.message || "the worker failed"); if (pending) settle({ error: e.message }); else reject(e); };
});
window.__run = (payload) => new Promise((resolve) => {
  pending = (v) => {
    if (v.result) {
      const keep = {};
      for (const [k, c] of Object.entries(v.result.competitors ?? {})) keep[k] = c && c.error !== undefined ? { error: c.error } : { rounds: c.rounds, stats: c.stats };
      resolve({ result: { competitors: keep } });
    } else resolve(v);
  };
  worker.postMessage({ type: "start", payload });
});
window.__stopWorker = () => { settle({ error: "the worker was stopped" }); if (worker) worker.terminate(); worker = null; };
</script>`;

server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path === "/__harness.html") {
    res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
    return;
  }
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const page = await browser.newPage();
page.setDefaultTimeout(0);
await page.goto(`${origin}/__harness.html`);

function withLimit(promise, ms, what) {
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(what)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
async function startWorker() {
  await withLimit(page.evaluate(() => window.__startWorker()), LOAD_LIMIT_MS, "the worker did not become ready in 5 minutes");
}
try {
  console.log("starting the worker (Pyodide and the wheels load first)");
  await startWorker();
} catch (e) {
  await stop(`The worker did not start: ${e.message}. Nothing was written.`);
}

// ---- 8. the runs ----
const plan = DRY ? planRuns().slice(0, 1) : planRuns();
const runs = [];
const date = new Date().toISOString().slice(0, 10);

for (const [i, { map, seed }] of plan.entries()) {
  const request = buildRequest(CHOICES[map], seed);
  const lab = settingsProblem(request);
  if (lab) await stop(`The request for ${map}, seed ${seed}: ${lab}. Nothing was written.`);
  if (!Array.isArray(request.graph.edges)) await stop(`The request for ${map} has no edge list. Nothing was written.`);
  let outcome;
  let restart = false;
  try {
    outcome = await withLimit(page.evaluate((p) => window.__run(p), request), RUN_LIMIT_MS, "the run took longer than 10 minutes");
  } catch (e) {
    outcome = { error: String(e.message).split("\n")[0] };
    restart = true;
  }
  const { record, checks } = assembleRecord({ map, seed, request, outcome });
  runs.push(record);
  console.log(`[${i + 1}/${plan.length}] ${map}, seed ${seed}: ${record.status}${record.reason ? ` (${record.reason})` : ""}`);
  if (DRY) {
    console.log("\nrecord:\n" + JSON.stringify(record, null, 2));
    console.log("\nchecks:");
    for (const c of checks) console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.competitor}: ${c.check}${c.ok ? "" : ` - ${c.detail}`}`);
    if (checks.length === 0) console.log("  (not run: the run failed before there was a result)");
  }
  if (restart) {
    // The worker may be stuck or gone. A new worker is needed for the next run.
    try {
      await page.evaluate(() => window.__stopWorker());
      await startWorker();
    } catch (e) {
      await stop(`The worker could not be restarted after run ${i + 1}: ${e.message}. Nothing was written.`);
    }
  }
}

// ---- 9. --check: compare, write nothing ----
if (CHECK) {
  await cleanup();
  const diffs = compareRecords(committed.runs, runs);
  if (diffs.length === 0) {
    console.log(`\nCHECK PASSED: all ${runs.length} runs reproduce web/public/results.json exactly. Nothing was written.`);
    process.exit(0);
  }
  console.log(`\nCHECK FAILED: ${diffs.length} difference(s) from web/public/results.json. Nothing was written.`);
  for (const d of diffs) console.log(`  ${d}`);
  process.exit(1);
}

// ---- 10. write once, atomically ----
if (DRY) {
  await cleanup();
  console.log("\nDRY RUN: nothing was written (web/public/results.json is untouched).");
  process.exit(0);
}
const file = assembleFile({ settings: buildSettings(engine), runs, date, commit, chromium: chromiumVersion, pyodide });
const tmpOut = `${outFile}.tmp`;
try {
  writeFileSync(tmpOut, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmpOut, outFile);
} catch (e) {
  rmSync(tmpOut, { force: true });
  await stop(`Could not write results.json (${e.message}).`);
}
const counts = { ok: 0, bad: 0, failed: 0 };
for (const r of runs) counts[r.status]++;
await cleanup();
console.log(`\nWrote ${outFile}: ${runs.length} runs (ok ${counts.ok}, bad ${counts.bad}, failed ${counts.failed}).`);
