// Measures how many points a "Your map" run can have (ui spec, task 13.9, requirement 8.13).
//
//   npm run measure-limit                  build dist, make the 54 runs, write the measurements at the end
//   npm run measure-limit -- --no-build    reuse an existing dist/
//   npm run measure-limit -- --dry-run     the warm-up run and ONE counted run (25 points, dense), write NOTHING
//
// The settings are fixed in measure-lib.mjs and in the ui design (section "Point limit: how it is
// measured"), before the first run. Summary: built dist, Chromium through Playwright, one worker, runs one
// after the other. Requests come from the app's own buildRequest (a Your map request, all four Competitors).
// The time of a run is the time from sending the request to the worker until the result is back, so the
// page load, Pyodide start and playback are not in it. Every run goes into the file. Nothing is retried,
// removed or replaced. These numbers size the limit on this laptop. They are not a speed comparison.
//
// Output: web/scripts/limit-measurements.json (written once, at the end, atomically) and a Markdown table
// on screen, with the resulting limit by the rule of the design. The script does not change settings.ts.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cpus, platform, release, totalmem } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LAYOUTS,
  LAYOUT_SEEDS,
  LIMIT_SECONDS,
  RUN_SEED,
  SIZES,
  STOP_SECONDS,
  TIMEOUT_SECONDS,
  WARMUP,
  computeLimit,
  formatTable,
  planRuns,
  shouldStopAfter,
} from "./measure-lib.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const dist = join(web, "dist");
const outFile = join(web, "scripts", "limit-measurements.json");
const DRY = process.argv.includes("--dry-run");
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

// ---- 1. app commit (before the build) ----
let commit = "unknown";
try {
  const dirty = git(["status", "--porcelain"]).trim() !== "";
  commit = git(["rev-parse", "HEAD"]).trim() + (dirty ? " dirty" : "");
} catch {
  /* not a git checkout: the file says "unknown" */
}
console.log(`app commit: ${commit}`);

// ---- 2. build ----
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

// ---- 3. the app's own code, bundled into a temp dir outside src and dist ----
tmp = mkdtempSync(join(tmpdir(), "atommap-measure-"));
let app;
try {
  const { build } = await import("vite");
  mkdirSync(join(tmp, "entry"));
  const entry = join(tmp, "entry", "entry.ts");
  const src = (f) => JSON.stringify(join(web, "src", f).replaceAll("\\", "/"));
  writeFileSync(
    entry,
    [
      `export { buildRequest } from ${src("screens/map-request.ts")};`,
      `export { mulberry32, round1, formatId } from ${src("your-map/editor.ts")};`,
      `export { DEFAULT_SEED, YOUR_MAP_AREA_M, POINT_LIMIT } from ${src("settings.ts")};`,
      "",
    ].join("\n"),
  );
  await build({
    root: web,
    configFile: false,
    logLevel: "warn",
    build: { outDir: join(tmp, "out"), emptyOutDir: true, minify: false, lib: { entry, formats: ["es"], fileName: () => "app.mjs" } },
  });
  app = await import(pathToFileURL(join(tmp, "out", "app.mjs")).href);
} catch (e) {
  await stop(`Cannot bundle the app code (${e.message}). Nothing was written.`);
}
if (app.DEFAULT_SEED !== RUN_SEED) await stop(`DEFAULT_SEED is ${app.DEFAULT_SEED}, but the plan fixes the run seed ${RUN_SEED}. Nothing was written.`);

/** The points of a layout seed: the first n points drawn by mulberry32(layoutSeed), rounded to 0.1 m, in the area. */
function pointsFor(n, layoutSeed) {
  const rng = app.mulberry32(layoutSeed);
  const { width, height } = app.YOUR_MAP_AREA_M;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = app.round1(rng() * width);
    const y = app.round1(rng() * height);
    pts.push({ id: app.formatId(i + 1), x, y });
  }
  return pts;
}
const requestFor = (n, layoutSeed, r) => app.buildRequest({ mode: "your_map", points: pointsFor(n, layoutSeed), r }, RUN_SEED);

// ---- 4. Chromium and the harness page ----
let chromium;
try {
  ({ chromium } = await import("playwright"));
  browser = await chromium.launch();
} catch (e) {
  await stop(`Chromium cannot start (${String(e.message).split("\n")[0]}). Try: npx playwright install chromium`);
}
const chromiumVersion = browser.version();
console.log(`Chromium ${chromiumVersion}`);

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".whl": "application/octet-stream", ".zip": "application/zip", ".map": "application/json",
};
// The harness only creates the worker, sends the request, and times it. It keeps no result data.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>harness</title><script>
let worker = null, pending = null;
function settle(v) { const p = pending; pending = null; if (p) p(v); }
window.__startWorker = () => new Promise((resolve, reject) => {
  worker = new Worker(new URL("worker.js", location.href).href);
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") resolve(true);
    else if (m.type === "result") settle({ result: m.payload });
    else if (m.type === "error") { if (pending) settle({ error: m.payload.message || "error" }); else reject(new Error(m.payload.message)); }
  };
  worker.onerror = (ev) => { const e = new Error(ev.message || "the worker failed"); if (pending) settle({ error: e.message }); else reject(e); };
});
window.__run = (payload) => new Promise((resolve) => {
  const t0 = performance.now();
  pending = (v) => {
    const ms = performance.now() - t0;
    if (v.result) {
      const comps = v.result.competitors ?? {};
      const bad = Object.entries(comps).filter(([, c]) => c && c.error !== undefined).map(([k]) => k);
      const skipped = Object.values(comps).reduce((s, c) => s + ((c && c.stats && c.stats.skipped_tiles) || 0), 0);
      resolve({ ms, competitors: Object.keys(comps).length, failedCompetitors: bad, skippedTiles: skipped });
    } else resolve({ ms, error: v.error });
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
async function restartWorker(after) {
  try {
    await page.evaluate(() => window.__stopWorker());
    await startWorker();
  } catch (e) {
    await stop(`The worker could not be restarted after ${after}: ${e.message}. Nothing was written.`);
  }
}
/** One run. Returns the record of the run. A timeout or error is a failed run, kept in the table. */
async function measure({ size, layout, r, layoutSeed }) {
  const request = requestFor(size, layoutSeed, r);
  let out;
  let restart = false;
  try {
    out = await withLimit(page.evaluate((p) => window.__run(p), request), TIMEOUT_SECONDS * 1000, "timeout");
  } catch {
    out = { ms: TIMEOUT_SECONDS * 1000, error: "timeout" };
    restart = true;
  }
  const failed = out.error !== undefined || out.failedCompetitors?.length > 0 || out.competitors !== 4;
  const record = {
    size,
    layout,
    r,
    layout_seed: layoutSeed,
    edges: request.graph.edges.length,
    seconds: Math.round(out.ms) / 1000,
    ok: !failed,
    skipped_tiles: out.skippedTiles ?? null,
  };
  if (failed) record.reason = out.error ?? (out.failedCompetitors?.length ? `error in ${out.failedCompetitors.join(", ")}` : "not all four Competitors finished");
  if (out.error !== undefined) restart = true;
  if (restart) await restartWorker(`${size} points, ${layout}, layout seed ${layoutSeed}`);
  return record;
}

try {
  console.log("starting the worker (Pyodide and the wheels load first)");
  await startWorker();
} catch (e) {
  await stop(`The worker did not start: ${e.message}. Nothing was written.`);
}

// ---- 5. warm-up (not counted), then the plan ----
const wr = LAYOUTS.find((l) => l.name === WARMUP.layout).r;
const warm = await measure({ size: WARMUP.size, layout: WARMUP.layout, r: wr, layoutSeed: WARMUP.layoutSeed });
console.log(`warm-up (not counted): ${WARMUP.size} points, ${WARMUP.layout}: ${warm.seconds.toFixed(1)} s${warm.ok ? "" : ` FAILED (${warm.reason})`}`);

const plan = DRY ? planRuns().slice(0, 1) : planRuns();
const runs = [];
let stoppedAfter = null;
for (const [i, p] of plan.entries()) {
  if (stoppedAfter !== null && p.size > stoppedAfter) continue;
  const rec = await measure(p);
  runs.push(rec);
  console.log(
    `[${i + 1}/${plan.length}] ${p.size} points, ${p.layout} (r ${p.r} m), layout seed ${p.layoutSeed}: ${rec.seconds.toFixed(1)} s, ${rec.edges} edges, ${rec.ok ? "ok" : `FAILED (${rec.reason})`}`,
  );
  const last = plan[i + 1];
  if (!DRY && (last === undefined || last.size !== p.size) && shouldStopAfter(runs.filter((r) => r.size === p.size))) {
    stoppedAfter = p.size;
    console.log(`a run of ${p.size} points took over ${STOP_SECONDS} s, so the larger sizes are not run`);
  }
}

// ---- 6. result ----
const limit = computeLimit(runs);
const table = formatTable(runs);
const machine = {
  cpu: cpus()[0]?.model?.trim() ?? "unknown",
  logical_cpus: cpus().length,
  memory_gb: Math.round(totalmem() / 2 ** 30),
  os: `${platform()} ${release()}`,
};
if (DRY) {
  await cleanup();
  console.log(`\n${table}\n\nDRY RUN: nothing was written. This one run says nothing about the limit.`);
  process.exit(0);
}
const file = {
  note: "Sizing of the Point_Limit of Your map on one laptop. Not a speed comparison. See .kiro/specs/ui/design.md.",
  date: new Date().toISOString().slice(0, 10),
  commit,
  chromium: chromiumVersion,
  pyodide,
  machine,
  settings: {
    sizes: SIZES,
    layouts: LAYOUTS,
    layout_seeds: LAYOUT_SEEDS,
    run_seed: RUN_SEED,
    warmup: WARMUP,
    limit_seconds: LIMIT_SECONDS,
    stop_seconds: STOP_SECONDS,
    timeout_seconds: TIMEOUT_SECONDS,
  },
  warmup_run: warm,
  runs,
  limit_by_rule: limit,
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
console.log(`\n${table}\n`);
console.log(`Computer: ${machine.cpu}, ${machine.logical_cpus} logical CPUs, ${machine.memory_gb} GB, ${machine.os}. Chromium ${chromiumVersion}, Pyodide ${pyodide}.`);
console.log(limit === null
  ? `Limit by the rule: none. Even ${SIZES[0]} points did not qualify. Stop and tell the person who runs the project.`
  : `Limit by the rule (every run of this size and of all smaller sizes finished without error in ${LIMIT_SECONDS} s or less): ${limit} points.`);
console.log(`Wrote ${outFile}: ${runs.length} runs.`);
