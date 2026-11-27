// Layout check of every Scene (experience spec, task 12.1; Requirements 21.1 to 21.3, 22.7), against
// the BUILT dist.
//
//   npm run layout-check              build (scripts/build-site.mjs), serve dist/ on localhost, drive Chromium
//   npm run layout-check -- --no-build   reuse an existing dist/
//
// At 1366 x 768 the page must not scroll vertically in any state (document.scrollingElement.scrollHeight
// <= innerHeight). At 375 x 667 the page must not scroll sideways (scrollWidth <= innerWidth) and every
// visible control must lie inside the width; the Your map controls also get a trial click (visible,
// enabled, nothing on top of it).
// Part 1, Your map: the starting map; empty after Clear; 20 points; a Map_Text error message; an r
// message; a run in progress; a finished run with the Tutor.
// Part 2, the scene flow: the Choose_Scene; for the wifi hall, Kadıköy, both US maps and Today's map the
// Map_Scene, the Run_Scene, the Results_Scene and the Results_Scene with "Show the list" open (its list
// must scroll to its last item); the Results_Page. The runs of part 2 happen at 1366 x 768; the
// Map_Scene and the Results_Scene are then checked again at 375 x 667 by resizing the same page.
// Run numbers: the test page fixes them (crypto.getRandomValues is stubbed for one-number requests in
// the test page only), so every check runs with Run #1. The app has no switch for this.
//
// Exit codes: 0 pass, 1 fail, 0 with a "LAYOUT CHECK SKIPPED" line if the build or Chromium is not available.import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const started = Date.now();
const secs = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const LOAD = 120_000;
const RUN = 600_000;

function skip(why) {
  console.log(`LAYOUT CHECK SKIPPED: ${why}`);
  process.exit(0);
}

if (!process.argv.includes("--no-build")) {
  console.log("layout-check: building (node scripts/build-site.mjs)");
  const r = spawnSync(process.execPath, [join(web, "scripts", "build-site.mjs")], { cwd: web, stdio: "inherit" });
  if (r.error || r.status !== 0) skip(`the build did not finish (exit ${r.status ?? r.error}); see the output above`);
}
if (!existsSync(join(dist, "index.html"))) skip("web/dist/index.html is missing, run the build first");

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

const problems = [];
const lines = [];
const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "375x667", width: 375, height: 667 },
];

/** The controls of Your map that must be reachable. Each is [label, locator factory]. */
const controls = (page) => [
  ["r input", page.getByLabel("r (metres)")],
  ["Clear", page.getByRole("button", { name: "Clear" })],
  ["Add random points", page.getByRole("button", { name: "Add random points" })],
  ["Run", page.getByRole("button", { name: "Run", exact: true })],
  ["Points as text box", page.locator("#maptext-box")],
  ["Use these points", page.getByRole("button", { name: "Use these points" })],
  ["file input", page.locator('.maptext-panel input[type="file"]')],
];

async function check(page, vp, state, { editor }) {
  const m = await page.evaluate(() => {
    const el = document.scrollingElement;
    return { sh: el.scrollHeight, ih: window.innerHeight, sw: el.scrollWidth, iw: window.innerWidth };
  });
  const bad = [];
  if (vp.width === 1366 && m.sh > m.ih) bad.push(`page scrolls: scrollHeight ${m.sh} > innerHeight ${m.ih}`);
  if (vp.width === 375 && m.sw > m.iw) bad.push(`page scrolls sideways: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
  if (vp.width === 375 && editor) {
    for (const [label, loc] of controls(page)) {
      if (!(await loc.isVisible())) {
        bad.push(`${label} is not visible`);
        continue;
      }
      const box = await loc.boundingBox();
      if (box && (box.x < -0.5 || box.x + box.width > m.iw + 0.5)) {
        bad.push(`${label} is outside the width (x ${box.x.toFixed(0)}, width ${box.width.toFixed(0)})`);
      }
      // A trial click scrolls to the control and checks that it is enabled and not covered. Nothing is clicked.
      const enabled = await loc.isEnabled();
      if (enabled) {
        try {
          await loc.click({ trial: true, timeout: 5000 });
        } catch (e) {
          bad.push(`${label} cannot be clicked (${String(e.message).split("\n")[0]})`);
        }
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  const verdict = bad.length === 0 ? "ok" : `FAIL: ${bad.join("; ")}`;
  lines.push(`${vp.name}  ${state.padEnd(34)} height ${String(m.sh).padStart(4)}/${m.ih}  width ${String(m.sw).padStart(4)}/${m.iw}  ${verdict}`);
  for (const b of bad) problems.push(`${vp.name}, ${state}: ${b}`);
}

async function ready(page, count, note) {
  const n = await page.locator('ul[aria-label="Points"] li').count();
  if (n !== count) problems.push(`${note}: expected ${count} points, found ${n}`);
}

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    page.on("pageerror", (e) => problems.push(`${vp.name}: page error: ${e.message}`));
    await page.goto(origin + "/", { timeout: 30_000 });
    // The scene flow (experience spec): the Choose_Scene, then the Your map card.
    await page.getByRole("heading", { name: "Choose a map" }).waitFor({ state: "visible", timeout: LOAD });
    await page.getByRole("button", { name: /^Open Your map/ }).click();
    await page.locator("main.mapflow").waitFor({ state: "visible", timeout: LOAD });
    // The Points as text panel is folded by default; open it so its controls are checked too.
    await page.locator(".maptext-panel summary").click();
    // Runs need the simulator: wait for the enabled Run button before the first check.
    await page.getByRole("button", { name: "Run", exact: true }).waitFor({ state: "visible", timeout: LOAD });
    const clear = page.getByRole("button", { name: "Clear" });
    const random = page.getByRole("button", { name: "Add random points" });
    const useText = page.getByRole("button", { name: "Use these points" });
    const box = page.locator("#maptext-box");
    const rInput = page.getByLabel("r (metres)");
    const run = page.getByRole("button", { name: "Run", exact: true });

    await ready(page, 8, `${vp.name} starting map`);
    await check(page, vp, "starting map (8 points)", { editor: true });

    await clear.click();
    await check(page, vp, "empty after Clear", { editor: true });

    await random.click();
    await random.click();
    await ready(page, 20, `${vp.name} 20 points`);
    await check(page, vp, "20 points", { editor: true });

    await box.fill("id,x\na,1");
    await useText.click();
    await check(page, vp, "Map_Text error message", { editor: true });

    await rInput.fill("1");
    await check(page, vp, "r message", { editor: true });
    await rInput.fill("20");

    // A small map for the run, from the text path (also the keyboard way to make a map).
    await box.fill("id,x,y\na,10,10\nb,15,10\nc,60,40\nd,62,41\ne,30,30");
    await useText.click();
    await ready(page, 5, `${vp.name} pasted map`);
    await run.click();
    await check(page, vp, "run in progress", { editor: false });

    // A small map can finish before the skip button is clicked; then the results scene is
    // already up and there is nothing to skip. Click it only while it is still there.
    const skipBtn = page.getByRole("button", { name: "Skip to the end" });
    await skipBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('[role="radiogroup"] .score-card[data-state="ready"]').length === 4,
      undefined,
      { timeout: RUN },
    );
    await check(page, vp, "finished run with the Tutor", { editor: false });
    console.log(`layout-check: ${vp.name} done at ${secs()}`);
    await page.close();
  }
} catch (e) {
  problems.push(String(e.message).split("\n")[0]);
}

// ---- Part 2: every Scene ----
/** In the test page only: a one-number crypto request gives 0, so randomRunNumber() is 1. */
const FIXED_RUN_NUMBER = () => {
  const real = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (a) => {
    if (a instanceof Uint32Array && a.length === 1) {
      a[0] = 0;
      return a;
    }
    return real(a);
  };
};
const NARROW = VIEWPORTS[1];
const WIDE = VIEWPORTS[0];

/** Page size, and at narrow widths every visible control inside the width. */
async function checkFlow(page, vp, state) {
  const m = await page.evaluate(() => {
    const el = document.scrollingElement;
    const outside = [];
    if (innerWidth < 600) {
      for (const c of document.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')) {
        if (c.closest('ul[aria-label="Points"], .visually-hidden, [hidden], [inert]')) continue;
        const r = c.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(c).visibility === "hidden") continue;
        if (r.left < -0.5 || r.right > innerWidth + 0.5) outside.push(`${c.tagName.toLowerCase()} "${(c.textContent || c.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
      }
    }
    return { sh: el.scrollHeight, ih: innerHeight, sw: el.scrollWidth, iw: innerWidth, outside };
  });
  const bad = [];
  if (vp.width === 1366 && m.sh > m.ih) bad.push(`page scrolls: scrollHeight ${m.sh} > innerHeight ${m.ih}`);
  if (vp.width === 375 && m.sw > m.iw) bad.push(`page scrolls sideways: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
  for (const o of m.outside) bad.push(`${o} is outside the width`);
  const verdict = bad.length === 0 ? "ok" : `FAIL: ${bad.join("; ")}`;
  lines.push(`${vp.name}  ${state.padEnd(34)} height ${String(m.sh).padStart(4)}/${m.ih}  width ${String(m.sw).padStart(4)}/${m.iw}  ${verdict}`);
  for (const b of bad) problems.push(`${vp.name}, ${state}: ${b}`);
}

async function atSize(page, vp) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(400); // the map lays out again on resize
}

/** "Show the list" open: its own scroll area takes focus and reaches its last item. */
async function checkList(page, vp, state) {
  const r = await page.evaluate(() => {
    const b = document.querySelector(".answer-list-body");
    if (!b || !b.closest("details")?.open) return "the list is not open";
    if (b.tabIndex !== 0) return "the list area does not take focus";
    const items = b.querySelectorAll("li");
    if (items.length === 0) return "the list has no items";
    b.scrollTop = b.scrollHeight;
    const last = items[items.length - 1].getBoundingClientRect();
    const box = b.getBoundingClientRect();
    if (last.bottom > box.bottom + 1 || last.top < box.top - 1) return `the last item cannot be scrolled into view (${Math.round(last.top)}..${Math.round(last.bottom)} vs ${Math.round(box.top)}..${Math.round(box.bottom)})`;
    if (box.bottom > innerHeight + 0.5 && innerWidth > 600) return `the list area ends below the window (${Math.round(box.bottom)} > ${innerHeight})`;
    b.scrollTop = 0;
    return null;
  });
  if (r !== null) problems.push(`${vp.name}, ${state}: ${r}`);
  await checkFlow(page, vp, state);
}

const FLOW_MAPS = [
  ["hall", "wifi hall"],
  ["kadikoy", "Kadıköy"],
  ["sf-bus", "SF bus stops"],
  ["nyc-bike", "NYC stations"],
  ["today", "Today's map"],
];

try {
  const ctx = await browser.newContext({ viewport: { width: WIDE.width, height: WIDE.height } });
  await ctx.addInitScript(FIXED_RUN_NUMBER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`scene flow: page error: ${e.message}`));
  await page.goto(origin + "/", { timeout: 30_000 });
  await page.getByRole("heading", { name: "Choose a map" }).waitFor({ state: "visible", timeout: LOAD });
  await page.locator(".map-card-status").last().waitFor({ state: "hidden", timeout: LOAD }).catch(() => {});
  await page.waitForTimeout(800);
  await checkFlow(page, WIDE, "Choose_Scene");
  await atSize(page, NARROW);
  await checkFlow(page, NARROW, "Choose_Scene");
  await atSize(page, WIDE);

  for (const [slug, name] of FLOW_MAPS) {
    await page.goto(`${origin}/#/map/${slug}`);
    // During a scene change the outgoing scene's copy is a second main for a moment.
    await page.waitForFunction(() => document.querySelectorAll("main.mapflow").length === 1 && document.querySelector("main.mapflow").dataset.scene === "map", undefined, { timeout: LOAD });
    await page.locator('main.mapflow ul[aria-label="Points"] li').first().waitFor({ state: "attached", timeout: LOAD });
    await page.waitForTimeout(800);
    await checkFlow(page, WIDE, `${name}: Map_Scene`);
    await atSize(page, NARROW);
    await checkFlow(page, NARROW, `${name}: Map_Scene`);
    await atSize(page, WIDE);
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Run"); return b && !b.disabled; }, undefined, { timeout: LOAD });
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.waitForTimeout(500);
    await checkFlow(page, WIDE, `${name}: Run_Scene`);
    await page.getByRole("button", { name: "Skip to the end" }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelector('main.mapflow[data-scene="results"]') && document.querySelectorAll('[role="radiogroup"] .score-card[data-state="ready"]').length === 4,
      undefined,
      { timeout: RUN },
    );
    await page.waitForTimeout(700);
    await checkFlow(page, WIDE, `${name}: Results_Scene`);
    await page.locator(".answer-list summary").click();
    await page.waitForTimeout(400);
    await checkList(page, WIDE, `${name}: Results, list open`);
    await atSize(page, NARROW);
    await checkList(page, NARROW, `${name}: Results, list open`);
    await page.locator(".answer-list summary").click();
    await page.waitForTimeout(300);
    await checkFlow(page, NARROW, `${name}: Results_Scene`);
    await atSize(page, WIDE);
    console.log(`layout-check: ${name} done at ${secs()}`);
  }

  await page.goto(`${origin}/#/results`);
  await page.getByRole("heading", { name: "What we measured" }).waitFor({ state: "visible", timeout: LOAD });
  await page.waitForTimeout(500);
  await atSize(page, NARROW);
  await checkFlow(page, NARROW, "Results_Page");
  await ctx.close();
} catch (e) {
  problems.push(`scene flow: ${String(e.message).split("\n")[0]}`);
}
await browser.close();
server.close();

console.log(lines.join("\n"));
if (problems.length > 0) {
  console.error(`LAYOUT CHECK FAILED (after ${secs()}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`LAYOUT CHECK PASSED in ${secs()}`);
