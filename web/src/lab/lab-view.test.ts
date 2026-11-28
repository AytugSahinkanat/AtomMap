// Lab DOM tests (experience spec, task 14.6; Requirements 16.2, 16.3, 16.4, 16.5, 18.1) in real
// headless Chromium, like the Plan_Selector tests: a Vite dev server serves the real modules to a
// blank page. If Chromium cannot start, the tests are skipped with a message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let startError = "";

const HARNESS = `
import { createLabView } from '/src/lab/lab-view.ts';
import { createScoreboard } from '/src/screens/scoreboard.ts';
window.__h = { createLabView, createScoreboard };
window.__ready = true;
`;

beforeAll(async () => {
  try {
    server = await createServer({ logLevel: "silent", server: { port: 5291, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("no dev server url");
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.route(`${base}harness.html`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
    await page.goto(`${base}harness.html`);
    await page.addScriptTag({ type: "module", content: HARNESS });
    await page.waitForFunction("window.__ready === true", undefined, { timeout: 30000 });
  } catch (e) {
    startError = String(e);
    page = null;
  }
}, 90000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

type Ctx = { skip: (note?: string) => never };
function need(ctx: Ctx): Page {
  if (page === null) ctx.skip(`browser not available: ${startError}`);
  return page!;
}

/** A fresh lab view on the page, its runs counted in window.__runs. */
async function mount(p: Page, readOnly = false): Promise<void> {
  await p.evaluate((ro) => {
    const W = window as any;
    W.__runs = [];
    const v = W.__h.createLabView({ onRun: (x: unknown) => W.__runs.push(x), onLeave: () => {}, onDownloadLog: () => null });
    document.body.replaceChildren(v.bar, v.left, v.right);
    v.setMap("Wifi hall", { value: 20, readOnly: ro });
    v.setControls({ seed: 5, r: 20, shots: 100, top_share: 0.4 });
    v.setRunButton({ enabled: true, text: "Run again" });
    W.__v = v;
  }, readOnly);
}
const runs = (p: Page) => p.evaluate(() => (window as any).__runs as unknown[]);

describe("lab view (real Chromium)", () => {
  it("an experiment card fills the instruments and never starts a run", async (ctx) => {
    const p = need(ctx);
    await mount(p);
    for (const name of ["10 shots", "Top group 100%", "Another run number", "A bigger r", "Top group 10%"]) {
      await p.getByRole("button", { name: `Set it up: ${name}` }).click();
    }
    expect(await runs(p)).toEqual([]);
    expect(await p.inputValue("#lab-shots")).toBe("10");
    expect(await p.inputValue("#lab-top")).toBe("10");
    expect(await p.inputValue("#lab-seed")).toBe("6");
    expect(await p.inputValue("#lab-r")).toBe("30");
    expect(await p.evaluate(() => document.activeElement?.className)).toBe("lab-run");
    // Run again then runs with exactly these values.
    await p.locator(".lab-run").click();
    expect(await runs(p)).toEqual([{ seed: 6, r: 30, shots: 10, top_share: 0.1 }]);
  });

  it("a value outside its range shows its message next to it and starts no run", async (ctx) => {
    const p = need(ctx);
    await mount(p);
    await p.fill("#lab-shots", "5");
    await p.fill("#lab-top", "abc");
    await p.locator(".lab-run").click();
    expect(await runs(p)).toEqual([]);
    expect(await p.locator("#lab-shots-msg").textContent()).toBe("Shots must be from 10 to 200. 5 is outside.");
    expect(await p.locator("#lab-top-msg").textContent()).toBe("Type a percent from 10 to 100.");
    expect(await p.evaluate(() => document.activeElement?.id)).toBe("lab-shots");
    expect(await p.locator("#lab-shots").getAttribute("aria-invalid")).toBe("true");
  });

  it("on walking maps r is read-only with its note, and the bigger-r card says why it cannot be used", async (ctx) => {
    const p = need(ctx);
    await mount(p, true);
    expect(await p.locator("#lab-r").getAttribute("readonly")).not.toBeNull();
    expect(await p.locator("#lab-r-note").textContent()).toContain("Walking distances were measured on the streets for r = 20 m.");
    await p.getByRole("button", { name: "Set it up: A bigger r" }).click();
    expect(await p.inputValue("#lab-r")).toBe("20");
    expect(await p.locator(".lab-exp-status").textContent()).toContain("r is fixed");
    expect(await runs(p)).toEqual([]);
  });

  it("the history has one row per lab run, in order, with the run's numbers", async (ctx) => {
    const p = need(ctx);
    await mount(p);
    await p.evaluate(() => {
      (window as any).__v.setHistory([
        { runNumber: 5, r: 20, shots: 20, topShare: 1, totals: [29, 35, 34, 34], hybridShare: 0.114 },
        { runNumber: 6, r: 24, shots: 10, topShare: 0.4, totals: [28, 32, 36, null], hybridShare: null },
      ]);
    });
    const rows = await p.locator(".lab-history tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
    expect(rows).toEqual([
      ["5", "20", "20", "100%", "29/35/34/34", "11.4%"],
      ["6", "24", "10", "40%", "28/32/36/–", "–"],
    ]);
  });

  it("the readouts show the Lab_Label of a lab run and say so for a normal one", async (ctx) => {
    const p = need(ctx);
    await mount(p);
    const line = (settings: unknown) =>
      p.evaluate((s) => {
        (window as any).__v.showReadouts({ runNumber: 5, r: 20, settings: s, competitors: {} }, null);
        return document.querySelector(".lab-label-line")?.textContent;
      }, settings);
    expect(await line({ shots: 20, top_share: 1 })).toBe("Lab settings: shots 20, top group 100%. Not the measured defaults.");
    expect(await line(null)).toBe("This run used the measured defaults.");
  });

  it("the Scoreboard shows the Lab_Label from the start of a lab run, and none on a normal run", async (ctx) => {
    const p = need(ctx);
    const read = await p.evaluate(() => {
      const W = window as any;
      const sb = W.__h.createScoreboard({ onRepeat() {}, onRunAgain() {}, onBack() {}, announce() {} });
      document.body.replaceChildren(sb.el);
      sb.begin(5, "channel_plan", { labLabel: "Lab settings: shots 20, top group 100%. Not the measured defaults." });
      const lab = document.querySelector(".score-lab") as HTMLElement;
      const during = [lab.hidden, lab.textContent];
      sb.begin(6, "channel_plan");
      return { during, after: lab.hidden };
    });
    expect(read.during).toEqual([false, "Lab settings: shots 20, top group 100%. Not the measured defaults."]);
    expect(read.after).toBe(true);
  });
});
