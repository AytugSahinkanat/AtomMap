// Map_Check and Daily_Check (experience spec, Requirements 11.9, 13.4 to 13.6; design "US_Maps and
// Map_Checks"). Run by hand:
//
//   npm run check-maps                  build dist, make every run, write web/src/data/map-checks.json
//   npm run check-maps -- --no-build    reuse an existing dist/
//   npm run check-maps -- --dry-run     ONE US run and ONE daily run, printed, NOTHING written (a test of the script)
//
// The runs, fixed here before measuring:
//   - the two US maps, walking distance, seeds 1, 2 and 3 each (6 runs);
//   - Today's map on the ten Daily_Check dates 2026-12-01 to 2026-12-10, each with its Daily_Seed (10 runs).
// Every run asks for all four plans in one request, with the app defaults (no lab settings), and is
// timed in the built site: from the start message to the worker's result, one worker, one run after
// the other. Every run is written and printed, also a failed or slow one. No run is repeated.
// A run over 60 s is written with "over_limit": true. Nothing is changed because of it: a US map
// stays unlisted until its three runs are ok and within 60 s, and the Daily_Map is not changed
// automatically (the owner and the developer look at the numbers first).
//
// The file is written once, at the end, atomically. If the script stops half way, it writes nothing.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPETITORS, commitLabel } from "./record-lib.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const dist = join(web, "dist");
const outFile = join(web, "src", "data", "map-checks.json");
const DRY = process.argv.includes("--dry-run");

// ---- the fixed plan (decided before measuring) ----
const LIMIT_SECONDS = 60;
const US_MAPS = [
  { name: "sf_bus_stops", file: "place_sf_bus_stops.json" },
  { name: "nyc_bike_share", file: "place_nyc_bike_share.json" },
];
const US_SEEDS = [1, 2, 3];
const DAILY_DATES = Array.from({ length: 10 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
const RUN_LIMIT_MS = 10 * 60 * 1000; // a run that never ends is written as failed after 10 minutes
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

// ---- 1. commit, build ----
let commit;
try {
  commit = commitLabel(git(["rev-parse", "HEAD"]), git(["status", "--porcelain"]));
} catch (e) {
  await stop(`Cannot read the git commit: ${e.message}`);
}
console.log(`app commit: ${commit}`);
if (!process.argv.includes("--no-build")) {
  console.log("building dist (node scripts/build-site.mjs)");
  const r = spawnSync(process.execPath, [join(web, "scripts", "build-site.mjs")], { cwd: web, stdio: "inherit" });
  if (r.error || r.status !== 0) await stop("The build did not finish. See the output above. Nothing was written.");
}
if (!existsSync(join(dist, "index.html"))) await stop("web/dist/index.html is missing. Run without --no-build.");
let pyodide;
try {
  pyodide = JSON.parse(readFileSync(join(dist, "pyodide", "pyodide-lock.json"), "utf8")).info.version;
} catch (e) {
  await stop(`Cannot read the Pyodide version from dist/pyodide/pyodide-lock.json (${e.message}).`);
}
if (pyodide !== "0.27.7") await stop(`The build has Pyodide ${pyodide}, but it must be 0.27.7. Nothing was written.`);

// ---- 2. the app's own buildRequest, buildDailyMap and dailySeed, bundled outside src and dist ----
tmp = mkdtempSync(join(tmpdir(), "atommap-check-"));
let app;
try {
  const { build } = await import("vite");
  mkdirSync(join(tmp, "entry"));
  const entry = join(tmp, "entry", "entry.ts");
  const src = (f) => JSON.stringify(join(web, "src", f).replaceAll("\\", "/"));
  writeFileSync(
    entry,
    `export { buildRequest } from ${src("screens/map-request.ts")};\n` +
      `export { buildDailyMap } from ${src("daily/daily-map.ts")};\n` +
      `export { dailySeed } from ${src("run-number.ts")};\n`,
  );
  await build({
    root: web,
    configFile: false,
    logLevel: "warn",
    build: { outDir: join(tmp, "out"), emptyOutDir: true, minify: false, lib: { entry, formats: ["es"], fileName: () => "app.mjs" } },
  });
  app = await import(pathToFileURL(join(tmp, "out", "app.mjs")).href);
} catch (e) {
  await stop(`Cannot bundle the app's request code (${e.message}). Nothing was written.`);
}

// ---- 3. the requests ----
const plan = [];
for (const m of US_MAPS) {
  const path = join(repo, "fixtures", m.file);
  if (!existsSync(path)) await stop(`fixtures/${m.file} is missing. Nothing was written.`);
  const f = JSON.parse(readFileSync(path, "utf8"));
  for (const seed of US_SEEDS) {
    plan.push({
      kind: "us",
      map: m.name,
      fixture: f,
      seed,
      request: app.buildRequest({ mode: "place", points: f.points, walkingEdges: f.walking_edges, walking: true, r: f.r }, seed),
    });
  }
}
for (const date of DAILY_DATES) {
  const seed = app.dailySeed(new Date(`${date}T00:00:00Z`));
  const m = app.buildDailyMap(seed);
  plan.push({ kind: "daily", date, seed, map: m, request: app.buildRequest({ mode: "your_map", points: m.points, r: m.r }, seed) });
}
for (const p of plan) {
  if (p.request.settings !== undefined) await stop("A request carries lab settings. Measured runs use the defaults. Nothing was written.");
}

// ---- 4. Chromium, the built site and a harness page (not written into dist) ----
let chromium;
try {
  ({ chromium } = await import("playwright"));
  browser = await chromium.launch();
} catch (e) {
  await stop(`Chromium cannot start (${String(e.message).split("\n")[0]}). Try: npx playwright install chromium`);
}
const chromiumVersion = browser.version();
console.log(`Chromium ${chromiumVersion}, Pyodide ${pyodide}`);

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".whl": "application/octet-stream", ".zip": "application/zip", ".map": "application/json",
};
// The harness creates the worker of the built site, sends one request and times it to the result.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>harness</title><script>
let worker = null, pending = null;
function settle(v) { const p = pending; pending = null; if (p) p(v); }
window.__startWorker = () => new Promise((resolve, reject) => {
  worker = new Worker(new URL("worker.js", location.href).href);
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") resolve(true);
    else if (m.type === "result") settle({ result: m.payload });
    else if (m.type === "error") { if (pending) settle({ error: m.payload && m.payload.message ? m.payload.message : String(m.payload) }); else reject(new Error(m.payload.message)); }
  };
  worker.onerror = (ev) => { const e = new Error(ev.message || "the worker failed"); if (pending) settle({ error: e.message }); else reject(e); };
});
window.__run = (payload) => new Promise((resolve) => {
  const t0 = performance.now();
  pending = (v) => {
    const ms = performance.now() - t0;
    if (v.result) {
      const keep = {};
      for (const [k, c] of Object.entries(v.result.competitors ?? {})) keep[k] = c && c.error !== undefined ? { error: String(c.error.message ?? c.error) } : { stats: c.stats };
      resolve({ ms, competitors: keep });
    } else resolve({ ms, error: v.error });
  };
  worker.postMessage({ type: "start", payload });
});
window.__stopWorker = () => { settle({ error: "the worker was stopped" }); if (worker) worker.terminate(); worker = null; };
</script>`;
server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path === "/__harness.html") return void res.writeHead(200, { "content-type": "text/html" }).end(HARNESS);
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("not found");
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
  console.log("starting the worker (Pyodide and the wheels load first; not part of any run's time)");
  await startWorker();
} catch (e) {
  await stop(`The worker did not start: ${e.message}. Nothing was written.`);
}

// ---- 5. the runs: every one is kept, none is repeated ----
const round1 = (x) => Math.round(x * 10) / 10;
/** The run's outcome as a record: ok only when all four plans returned stats. */
function summarise(outcome) {
  const seconds = round1(outcome.ms / 1000);
  const base = { seconds, over_limit: seconds > LIMIT_SECONDS };
  if (outcome.error) return { ...base, ok: false, error: outcome.error };
  const totals = {};
  const quantum_share = {};
  const problems = [];
  for (const name of COMPETITORS) {
    const c = outcome.competitors?.[name];
    const total = c?.stats?.total_picks;
    const share = c?.stats?.quantum_share;
    if (!c || c.error !== undefined) problems.push(`${name}: ${c ? c.error : "missing"}`);
    else if (!Number.isInteger(total) || typeof share !== "number") problems.push(`${name}: no total_picks or quantum_share`);
    else {
      totals[name] = total;
      quantum_share[name] = share;
    }
  }
  return problems.length
    ? { ...base, ok: false, error: problems.join("; "), totals, quantum_share }
    : { ...base, ok: true, totals, quantum_share };
}

const maps = {};
const daily = [];
const toRun = DRY ? [plan.find((p) => p.kind === "us"), plan.find((p) => p.kind === "daily")] : plan;
for (const [i, p] of toRun.entries()) {
  let outcome;
  let restart = false;
  try {
    outcome = await withLimit(page.evaluate((req) => window.__run(req), p.request), RUN_LIMIT_MS, "the run took longer than 10 minutes");
  } catch (e) {
    outcome = { ms: RUN_LIMIT_MS, error: String(e.message).split("\n")[0] };
    restart = true;
  }
  const s = summarise(outcome);
  const label = p.kind === "us" ? `${p.map}, seed ${p.seed}` : `daily ${p.date} (seed ${p.seed})`;
  const totals = s.totals ? COMPETITORS.map((n) => s.totals[n] ?? "-").join("/") : "-";
  const share = s.quantum_share?.Hybrid !== undefined ? ` hybrid quantum share ${(s.quantum_share.Hybrid * 100).toFixed(1)}%` : "";
  console.log(
    `[${i + 1}/${toRun.length}] ${label}: ${s.ok ? "ok" : "FAILED"}, ${s.seconds} s, totals ${totals}${share}` +
      `${s.over_limit ? `  OVER THE ${LIMIT_SECONDS} s LIMIT` : ""}${s.error ? ` (${s.error})` : ""}`,
  );
  if (p.kind === "us") {
    maps[p.map] ??= {
      fixture: {
        osm_data_timestamp: p.fixture.source.osm_data_timestamp,
        points: p.fixture.points.length,
        walking_edges: p.fixture.walking_edges.length,
        r: p.fixture.r,
      },
      runs: [],
    };
    maps[p.map].runs.push({ seed: p.seed, ...s });
  } else {
    daily.push({ date: p.date, seed: p.seed, points: p.map.points.length, edges: p.map.edges.length, ...s });
  }
  if (restart) {
    try {
      await page.evaluate(() => window.__stopWorker());
      await startWorker();
    } catch (e) {
      await stop(`The worker could not be restarted after run ${i + 1}: ${e.message}. Nothing was written.`);
    }
  }
}

if (DRY) {
  await cleanup();
  console.log(`\nDRY RUN: ${toRun.length} runs, nothing was written (${outFile} is untouched).`);
  process.exit(0);
}

// ---- 6. write once, atomically ----
const file = {
  date: new Date().toISOString().slice(0, 10),
  commit,
  chromium: chromiumVersion,
  pyodide,
  limit_seconds: LIMIT_SECONDS,
  protocol:
    "Built site, Chromium through Playwright, one worker, the runs one after the other in this order. " +
    "US maps: walking distance, seeds 1, 2 and 3. Daily_Check: Today's map of 2026-12-01 to 2026-12-10, each with its Daily_Seed. " +
    "Each run asks for all four plans with the app defaults. Seconds: from the start message to the result, worker loading not included. " +
    "Every run is written, none is repeated. Quantum share is the fraction of picks from the atoms (0 to 1).",
  maps,
  daily,
};
const tmpOut = `${outFile}.tmp`;
try {
  writeFileSync(tmpOut, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmpOut, outFile);
} catch (e) {
  rmSync(tmpOut, { force: true });
  await stop(`Could not write ${outFile} (${e.message}).`);
}
await cleanup();
const all = [...Object.values(maps).flatMap((m) => m.runs), ...daily];
const over = all.filter((r) => r.over_limit).length;
const failed = all.filter((r) => !r.ok).length;
console.log(`\nWrote ${outFile}: ${all.length} runs, ${failed} failed, ${over} over the ${LIMIT_SECONDS} s limit.`);
if (over > 0) console.log(`Runs over ${LIMIT_SECONDS} s are written with "over_limit": true. Nothing else was changed.`);
