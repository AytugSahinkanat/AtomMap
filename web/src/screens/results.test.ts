// Results_Page render tests (ui spec, task 16.8; requirement 13).
//
// No jsdom in this project. Like plan-selector.test.ts, the DOM runs in real
// headless Chromium through Playwright, with a Vite dev server serving the
// real modules. If Chromium cannot start, the tests skip with a message.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { CARD_LABELS, CITATION } from "../scoreboard-model";
import committedText from "../../public/results.json?raw";
import exampleText from "../../test-data/results.example.json?raw";

const COMMITTED_FILE: any = JSON.parse(committedText);
const EXAMPLE_FILE: any = JSON.parse(exampleText);

const BANNED = /faster|speed|wins|winner|beats/i;

let server: ViteDevServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let startError = "";

const HARNESS = `
import * as R from '/src/screens/results.ts';
import { validateResults } from '/src/data/results.ts';
window.__r = { ...R, validateResults };
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
    await page.route(`${base}harness.html`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
    );
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

const shares = (n: number) => ({ Atoms_Alone: n, Hybrid: n, Annealing_Rules: n, Coin_Flip_Rules: n });
function run(seed: number, status: "ok" | "failed" | "bad", extra: Record<string, unknown> = {}) {
  return {
    seed,
    map: `map ${seed}`,
    picks: shares(seed),
    quantum_share: shares(0),
    atoms_not_needed: true,
    splits: 0,
    skipped_tiles: 0,
    status,
    ...(status === "ok" ? {} : { reason: "something happened" }),
    ...extra,
  };
}
function file(example: boolean, runs: unknown[]) {
  return { example, protocol: { text: "Fixed settings.", settings: { mode: "simulation", seeds: [1] } }, runs };
}

/** Render a file into the page and return a summary of the DOM. */
async function render(p: Page, f: unknown) {
  return p.evaluate((f) => {
    const W = window as any;
    const root: HTMLElement = W.__r.renderResultsPage(f);
    document.body.replaceChildren(root);
    const rows = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    return {
      text: document.body.textContent ?? "",
      notice: document.querySelector(".results-notice")?.textContent ?? null,
      seeds: rows.map((r) => r.cells[0].textContent),
      structure: rows.map((r) => ({
        tag: r.tagName,
        cls: r.className,
        cells: [...r.cells].map((c) => c.tagName + "." + c.className),
        n: r.cells.length,
      })),
      cellTexts: rows.map((r) => [...r.cells].map((c) => c.textContent as string)),
      status: rows.map((r) => r.dataset.status),
      caption: document.querySelector("table > caption")?.textContent ?? null,
      ths: [...document.querySelectorAll("thead th")].map((t) => ({ scope: t.getAttribute("scope"), text: t.textContent })),
      wrap: (() => {
        const w = document.querySelector<HTMLElement>(".results-scroll");
        return w ? { tab: w.tabIndex, label: w.getAttribute("aria-label"), role: w.getAttribute("role"), hasTable: !!w.querySelector("table") } : null;
      })(),
      cite: [...document.querySelectorAll("p")].map((x) => x.textContent),
    };
  }, f);
}

async function show(p: Page, mode: "fail" | "invalid" | "throw") {
  return p.evaluate(async (mode) => {
    const W = window as any;
    const box = document.createElement("div");
    document.body.replaceChildren(box);
    const load =
      mode === "fail"
        ? async () => ({ ok: false, reason: "The results file is missing." })
        : mode === "invalid"
          ? async () => ({ ok: true, value: { example: true, runs: "nope" } })
          : async () => {
              throw new Error("network down");
            };
    await W.__r.showResults(box, load);
    return {
      tables: box.querySelectorAll("table").length,
      error: box.querySelector(".results-error")?.textContent ?? null,
      text: box.textContent ?? "",
    };
  }, mode);
}

describe("Results_Page render (real Chromium)", () => {
  it("rows keep file order, no sorting", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(7, "ok"), run(2, "ok"), run(9, "ok"), run(1, "ok")]));
    expect(r.seeds).toEqual(["7", "2", "9", "1"]);
  });

  it("shows the example notice only when example is true", async (ctx) => {
    const p = need(ctx);
    const yes = await render(p, file(true, [run(1, "ok")]));
    expect(yes.notice).toBe("This is example data, not a measurement.");
    const no = await render(p, file(false, [run(1, "ok")]));
    expect(no.notice).toBeNull();
    expect(no.text).not.toContain("example data");
  });

  it("failed and bad rows use the same markup as ok rows", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(1, "ok"), run(2, "failed"), run(3, "bad")]));
    expect(r.status).toEqual(["ok", "failed", "bad"]);
    expect(r.structure[1]).toEqual(r.structure[0]);
    expect(r.structure[2]).toEqual(r.structure[0]);
    expect(r.cellTexts[1].some((t) => t.includes("failed: something happened"))).toBe(true);
    expect(r.cellTexts[2].some((t) => t.includes("bad: something happened"))).toBe(true);
  });

  it("shows 0% shares as 0%, and formats other shares", async (ctx) => {
    const p = need(ctx);
    const r = await render(
      p,
      file(false, [run(1, "ok"), run(2, "ok", { quantum_share: { Atoms_Alone: 100, Hybrid: 17.5, Annealing_Rules: 0, Coin_Flip_Rules: 0 } })]),
    );
    expect(r.cellTexts[0].filter((t) => t === "0%").length).toBe(4);
    expect(r.cellTexts[1].slice(6, 10)).toEqual(["100%", "17.5%", "0%", "0%"]);
  });

  it("has a caption and th scope=col for every header", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(1, "ok")]));
    expect(r.caption).toBeTruthy();
    expect(r.ths.length).toBe(r.structure[0].n);
    expect(r.ths.every((t) => t.scope === "col" && (t.text ?? "").length > 0)).toBe(true);
  });

  it("puts the table in a labelled, focusable scroll box", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(1, "ok")]));
    expect(r.wrap).toEqual({ tab: 0, label: "Results table, scrolls sideways", role: "region", hasTable: true });
  });

  it("shows the citation text exactly", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(1, "ok")]));
    expect(CITATION).toBe("Schuetz et al., Phys. Rev. Research 8, 033296 (2026), doi:10.1103/nh3b-1wv5");
    expect(r.cite).toContain(CITATION);
  });

  it("shows 'How these runs were made' only when the file has those fields", async (ctx) => {
    const p = need(ctx);
    const plain = await render(p, file(false, [run(1, "ok")]));
    expect(plain.text).not.toContain("How these runs were made");
    const f = { ...file(false, [run(1, "ok")]), date: "2026-01-02", commit: "abc123 dirty", chromium: "140.0.1", pyodide: "0.27.7" };
    const r = await render(p, f);
    const items = await p.evaluate(() => [...document.querySelectorAll(".results-how li")].map((x) => x.textContent));
    expect(items).toEqual(["Date (UTC): 2026-01-02", "App commit: abc123 dirty", "Chromium: 140.0.1", "Pyodide: 0.27.7"]);
    expect(r.text).not.toMatch(BANNED);
  });

  it("labels every row 'simulation'", async (ctx) => {
    const p = need(ctx);
    const r = await render(p, file(false, [run(1, "ok"), run(2, "failed"), run(3, "bad")]));
    for (const cells of r.cellTexts) expect(cells[cells.length - 1]).toBe("simulation");
  });

  it("has no banned words, also for the example fixture", async (ctx) => {
    const p = need(ctx);
    const synthetic = await render(p, file(true, [run(1, "ok"), run(2, "failed"), run(3, "bad")]));
    expect(synthetic.text).not.toMatch(BANNED);
    const valid = await p.evaluate((f) => (window as any).__r.validateResults(f), EXAMPLE_FILE);
    expect(valid.ok).toBe(true);
    const ex = await render(p, EXAMPLE_FILE);
    expect(ex.notice).toBe("This is example data, not a measurement.");
    expect(ex.seeds).toEqual(EXAMPLE_FILE.runs.map((x: any) => String(x.seed)));
    expect(ex.text).not.toMatch(BANNED);
    for (const cells of ex.cellTexts) expect(cells[cells.length - 1]).toBe("simulation");
  });
});

describe("Results_Page on the committed results.json (real Chromium)", () => {
  it("shows no example notice and no banned words", async (ctx) => {
    const p = need(ctx);
    const valid = await p.evaluate((f) => (window as any).__r.validateResults(f), COMMITTED_FILE);
    expect(valid.ok).toBe(true);
    expect(COMMITTED_FILE.example).toBe(false);
    const real = await render(p, COMMITTED_FILE);
    expect(real.notice).toBeNull();
    expect(real.text).not.toContain("example data");
    expect(real.text).not.toMatch(BANNED);
    expect(real.seeds).toEqual(COMMITTED_FILE.runs.map((x: any) => String(x.seed)));
    expect(real.seeds.length).toBe(30);
    for (const cells of real.cellTexts) expect(cells[cells.length - 1]).toBe("simulation");
  });
  it("shows the protocol text about the hybrid's columns", async (ctx) => {
    const p = need(ctx);
    const real = await render(p, COMMITTED_FILE);
    expect(real.text).toContain("atoms not needed, splits and skipped tiles are the hybrid's");
  });
});
describe("Results_Page settings text (real Chromium)", () => {
  it("shows lists and nested objects as plain text, no JSON", async (ctx) => {
    const p = need(ctx);
    const f = file(false, [run(1, "ok")]);
    f.protocol.settings = {
      seeds: [1, 2, 3, 4],
      channels: [1, 6, 11],
      pair: [1, 2],
      names: ["a", "b"],
      nested: { rounds: 3, range: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      mode: "simulation",
    } as any;
    const dd = await p.evaluate((f) => {
      const root: HTMLElement = (window as any).__r.renderResultsPage(f);
      document.body.replaceChildren(root);
      return [...document.querySelectorAll("dd")].map((d) => d.textContent);
    }, f);
    expect(dd).toEqual(["1 to 4", "1, 6, 11", "1, 2", "a, b", "rounds: 3, range: 1 to 10", "simulation"]);
    for (const t of dd) expect(t).not.toMatch(/[\[\]{}"]/);
  });
});

describe("Results_Page friendly settings (real Chromium)", () => {
  it("uses plain keys, percents and card names for the real settings", async (ctx) => {
    const p = need(ctx);
    const f = file(false, [run(1, "ok")]);
    f.protocol.settings = {
      shots: 100,
      tile_size: 10,
      top_group_share: 0.4,
      seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      maps: { "Wifi hall": "walls off", "Kadıköy, Istanbul": "walking distance" },
      competitors: ["Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules"],
      app_settings: "defaults",
      Hybrid: "Coin_Flip_Rules",
      other_share: 7,
    } as any;
    const out = await p.evaluate((f) => {
      const root: HTMLElement = (window as any).__r.renderResultsPage(f);
      document.body.replaceChildren(root);
      return {
        dt: [...document.querySelectorAll("dt")].map((d) => d.textContent),
        dd: [...document.querySelectorAll("dd")].map((d) => d.textContent),
        th: [...document.querySelectorAll("thead th")].map((t) => t.textContent as string),
        text: document.querySelector(".results-settings")!.textContent as string,
      };
    }, f);
    const names = [CARD_LABELS.Atoms_Alone, CARD_LABELS.Hybrid, CARD_LABELS.Annealing_Rules, CARD_LABELS.Coin_Flip_Rules];
    expect(out.dt).toEqual([
      "shots", "tile size", "top group share", "seeds", "maps", "competitors", "app settings", CARD_LABELS.Hybrid, "other share",
    ]);
    expect(out.dd).toEqual([
      "100", "10", "40%", "1 to 10", "Wifi hall: walls off, Kadıköy, Istanbul: walking distance",
      names.join(", "), "defaults", CARD_LABELS.Coin_Flip_Rules, "7",
    ]);
    expect(out.text).not.toMatch(/_/);
    for (const n of names) {
      expect(out.th.some((t) => t.endsWith(n))).toBe(true);
    }
  });
});
describe("Results_Page error state (real Chromium)", () => {
  for (const mode of ["fail", "invalid", "throw"] as const) {
    it(`shows a reason and no table when the load is: ${mode}`, async (ctx) => {
      const p = need(ctx);
      const s = await show(p, mode);
      expect(s.tables).toBe(0);
      expect(s.error).toMatch(/^We could not show the results\. \S+/);
      expect(s.error!.length).toBeGreaterThan("We could not show the results. ".length);
      expect(s.text).not.toMatch(BANNED);
    });
  }
});
