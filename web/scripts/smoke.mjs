// Playwright smoke test against the BUILT dist (ui spec, task 14.1; requirements 2.8, 6.6, 12.3).
//
//   npm run smoke              build (scripts/build-site.mjs), serve dist/ on localhost, drive Chromium
//   npm run smoke -- --no-build   reuse an existing dist/
//
// Steps, twice (normal motion, then reducedMotion "reduce"), each in a fresh browser context: the
// Choose_Scene shows before the simulator is ready; the wifi hall card; wait for the enabled Run
// button; Run (Run #1, fixed in the test page only); "Skip to the end"; the Results_Scene within
// RESULTS_LAG_S of the worker's result; four ready cards; the answer headline with the most picks;
// with reduced motion no Element.animate call. Then every request went to the same origin (no tile
// server, no Overpass, no other host).
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
const RESULTS_LAG_S = 5; // skip was pressed: the Results_Scene must follow the result within this

/**
 * The test page only: Run #1 (crypto.getRandomValues gives 0 for one-number requests), and the page
 * times of the worker's ready and result messages, the Results_Scene, and every Element.animate call.
 * The app has no switch for any of this.
 */
function instrument() {
  const real = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (a) => {
    if (a instanceof Uint32Array && a.length === 1) {
      a[0] = 0;
      return a;
    }
    return real(a);
  };
  window.__readyAt = null;
  window.__resultAt = null;
  window.__resultsSceneAt = null;
  window.__animations = 0;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    window.__animations++;
    return animate.apply(this, args);
  };
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (e) => {
        if (e.data?.type === "ready" && window.__readyAt === null) window.__readyAt = performance.now();
        if (e.data?.type === "result" && window.__resultAt === null) window.__resultAt = performance.now();
      });
    }
  };
  new MutationObserver(() => {
    if (window.__resultsSceneAt === null && document.querySelector('main.mapflow[data-scene="results"]')) {
      window.__resultsSceneAt = performance.now();
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-scene"], childList: true });
}

/** One pass of the scene flow on the wifi hall. */
async function flow(name, reducedMotion) {
  const ctx = await browser.newContext({ reducedMotion });
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  page.on("request", (r) => urls.push(r.url()));
  page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
  const say = (m) => console.log(`smoke (${name}): ${m} at ${secs()}`);
  const fail = (m) => problems.push(`${name}: ${m}`);
  try {
    await page.goto(origin + "/", { timeout: 30_000 });
    // The Choose_Scene comes up at once; the simulator loads in the background (Requirement 23.1).
    await page.getByRole("heading", { name: "Choose a map" }).waitFor({ state: "visible", timeout: 30_000 });
    const chooseAt = await page.evaluate(() => performance.now());
    say("Choose_Scene visible");
    await page.getByRole("button", { name: /^Open Wifi hall/ }).click({ timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll("main.mapflow").length === 1, undefined, { timeout: 30_000 });
    const runText = await page.locator(".run-row button").first().textContent();
    say(`Map_Scene of the wifi hall, run button: "${runText}"`);
    const run = page.getByRole("button", { name: "Run", exact: true });
    await run.waitFor({ state: "visible", timeout: LOAD });
    await page.waitForFunction(() => window.__readyAt !== null, undefined, { timeout: LOAD });
    const readyAt = await page.evaluate(() => window.__readyAt);
    if (!(chooseAt < readyAt)) fail("the Choose_Scene did not show before the simulator was ready");
    say("simulator ready");
    await run.click({ timeout: LOAD });
    const skipBtn = page.getByRole("button", { name: "Skip to the end" });
    await skipBtn.waitFor({ state: "visible", timeout: RUN });
    await skipBtn.click({ timeout: RUN });
    say("Run and skip pressed");
    await page.waitForFunction(() => window.__resultsSceneAt !== null, undefined, { timeout: RUN }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('[role="radiogroup"] .score-card[data-state="ready"]').length === 4,
      undefined,
      { timeout: RUN },
    ).catch(() => {});
    const group = page.getByRole("radiogroup");
    const cards = await group.locator(".score-card").count();
    const readyCount = await group.locator('.score-card[data-state="ready"]').count();
    const totals = (await page.locator(".score-card .score-total").allTextContents()).map(Number);
    say(`${cards} cards, ${readyCount} ready, totals ${totals.join("/")}, ${await page.locator(".score-seed").textContent()}`);
    if (cards !== 4) fail(`expected 4 Competitor cards, found ${cards}`);
    if (readyCount !== 4) fail(`expected 4 ready cards, found ${readyCount}`);
    // After skip, the Results_Scene comes as soon as the result is in (no replay of later Groups).
    const { resultAt, sceneAt } = await page.evaluate(() => ({ resultAt: window.__resultAt, sceneAt: window.__resultsSceneAt }));
    if (resultAt === null) fail("the worker's result message was not seen");
    else if (sceneAt === null) fail("the Results_Scene did not show");
    else {
      const lag = (sceneAt - resultAt) / 1000;
      say(`Results_Scene ${lag.toFixed(2)} s after the worker's result`);
      if (lag > RESULTS_LAG_S) fail(`the Results_Scene came ${lag.toFixed(1)} s after the result (limit ${RESULTS_LAG_S} s)`);
    }
    // The Answer_Box: the hall's headline, with the most picks of the four cards.
    const headline = (await page.locator(".answer-headline").textContent()) ?? "";
    say(`answer: ${headline}`);
    const best = Math.max(...totals);
    if (!headline.startsWith(`Answer: ${best} of 70 access points get a 2.4 GHz channel`)) fail(`the answer does not say ${best} of 70: "${headline}"`);
    // Reduced motion: no scene transition, no container transform, nothing animated with Element.animate.
    const animations = await page.evaluate(() => window.__animations);
    say(`${animations} Element.animate calls`);
    if (reducedMotion === "reduce" && animations !== 0) fail(`${animations} animations ran with reduced motion`);
    if (reducedMotion !== "reduce" && animations === 0) fail("no scene animation ran (the counter may be broken)");
  } catch (e) {
    fail(String(e.message).split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

try {
  await flow("motion", "no-preference");
  await flow("reduced motion", "reduce");
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
