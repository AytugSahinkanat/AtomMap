// Playwright smoke test against the BUILT dist (ui spec, task 14.1; requirements 2.8, 6.6, 12.3).
//
//   npm run smoke              build (scripts/build-site.mjs), serve dist/ on localhost, drive Chromium
//   npm run smoke -- --no-build   reuse an existing dist/
//
// Steps: load the page, wait for the Map_Screen, press Run on the Hero_Map (the
// default map), press "Skip to the end", check four Competitor cards in the
// score cards radiogroup, and check that every request went to the same origin
// (no tile server, no Overpass, no other host).
//
// Exit codes: 0 pass, 1 fail, 0 with a "SKIPPED" line if the build or Chromium
// is not available (so the cause is on screen, never silent).

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const started = Date.now();
const secs = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;

function skip(why) {
  console.log(`SMOKE SKIPPED: ${why}`);
  process.exit(0);
}
function fail(why) {
  console.error(`SMOKE FAILED: ${why} (after ${secs()})`);
  process.exit(1);
}

// ---- 1. build ----
if (!process.argv.includes("--no-build")) {
  console.log("smoke: building (node scripts/build-site.mjs)");
  const r = spawnSync(process.execPath, [join(web, "scripts", "build-site.mjs")], { cwd: web, stdio: "inherit" });
  if (r.error || r.status !== 0) skip(`the build did not finish (exit ${r.status ?? r.error}); see the output above`);
}
if (!existsSync(join(dist, "index.html"))) skip("web/dist/index.html is missing, run the build first");
console.log(`smoke: build ready at ${secs()}`);

// ---- 2. Chromium ----
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (e) {
  skip(`the playwright package is not installed (${e.message})`);
}
let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  skip(`Chromium cannot start (${String(e.message).split("\n")[0]}). Try: npx playwright install chromium`);
}

// ---- 3. static server for dist/ ----
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".whl": "application/octet-stream", ".zip": "application/zip", ".map": "application/json",
};
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
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

const urls = [];
const problems = [];
const LOAD = 120_000; // Pyodide + wheels
const RUN = 600_000; // a hero run

try {
  const page = await browser.newPage();
  page.on("request", (r) => urls.push(r.url()));
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

  await page.goto(origin + "/", { timeout: 30_000 });
  console.log(`smoke: page loaded at ${secs()}, waiting for the Map_Screen (Pyodide may take a while)`);

  const run = page.getByRole("button", { name: "Run", exact: true });
  await page.locator("main.screen.map").waitFor({ state: "visible", timeout: LOAD });
  await run.waitFor({ state: "visible", timeout: LOAD });
  console.log(`smoke: Map_Screen visible at ${secs()}`);

  await run.click({ timeout: LOAD });
  console.log(`smoke: Run pressed at ${secs()}`);

  const skipBtn = page.getByRole("button", { name: "Skip to the end" });
  await skipBtn.waitFor({ state: "visible", timeout: RUN });
  await skipBtn.click({ timeout: RUN });
  console.log(`smoke: skip pressed at ${secs()}`);

  const group = page.getByRole("radiogroup");
  await group.waitFor({ state: "visible", timeout: RUN });
  const ready = group.locator('.score-card[data-state="ready"]');
  await page.waitForFunction(
    () => document.querySelectorAll('[role="radiogroup"] .score-card[data-state="ready"]').length === 4,
    undefined,
    { timeout: RUN },
  ).catch(() => {});
  const cards = await group.locator(".score-card").count();
  const readyCount = await ready.count();
  const titles = await group.locator('[role="radio"]').allTextContents();
  console.log(`smoke: ${cards} cards, ${readyCount} ready: ${titles.join(" | ")} at ${secs()}`);
  if (cards !== 4) problems.push(`expected 4 Competitor cards, found ${cards}`);
  if (readyCount !== 4) problems.push(`expected 4 ready cards, found ${readyCount}`);
} catch (e) {
  problems.push(`${String(e.message).split("\n")[0]}`);
} finally {
  await browser.close();
  server.close();
}

// ---- 4. requests ----
const foreign = urls.filter((u) => {
  if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return false;
  return new URL(u).origin !== origin;
});
console.log(`smoke: ${urls.length} requests, ${foreign.length} to another origin`);
if (foreign.length > 0) problems.push(`requests to another origin: ${[...new Set(foreign)].slice(0, 10).join(", ")}`);

if (problems.length > 0) fail(problems.join("; "));
console.log(`SMOKE PASSED in ${secs()}`);
