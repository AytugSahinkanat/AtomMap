// Layout check for Your map (ui spec, task 13.10, requirement 8.19), against the BUILT dist.
//
//   npm run layout-check              build (scripts/build-site.mjs), serve dist/ on localhost, drive Chromium
//   npm run layout-check -- --no-build   reuse an existing dist/
//
// At 1366 x 768 the page must not scroll vertically in any state of Your map
// (document.scrollingElement.scrollHeight <= innerHeight). At 375 x 667 the page must not scroll sideways
// (scrollWidth <= innerWidth), every control must lie inside the width, and every control must be clickable
// (a trial click: visible, enabled, nothing on top of it).
// States: the starting map; empty after Clear; 20 points; a Map_Text error message; an r message;
// a run in progress; a finished run with the Tutor.
//
// Exit codes: 0 pass, 1 fail, 0 with a "LAYOUT CHECK SKIPPED" line if the build or Chromium is not available.
import { spawnSync } from "node:child_process";
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
} finally {
  await browser.close();
  server.close();
}

console.log(lines.join("\n"));
if (problems.length > 0) {
  console.error(`LAYOUT CHECK FAILED (after ${secs()}):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`LAYOUT CHECK PASSED in ${secs()}`);
