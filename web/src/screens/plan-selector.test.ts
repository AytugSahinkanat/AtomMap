// Plan_Selector tests (ui spec, task 10.2; requirements 2.11, 12.1).
//
// The web project has no jsdom or happy-dom, and no new dependency is added.
// The DOM parts (scoreboard radios, Tutor strip) run in real headless Chromium
// through Playwright, which is already a devDependency: a Vite dev server
// serves the real modules to a blank page. If Chromium cannot start, the
// browser tests are skipped with a message and the pure data tests still run.
//
// Real results come from web/test-data/tutor (recorded runs, committed).
// Not covered here: paintPlan() in map.ts. It is a closure inside the map
// screen (needs the worker, canvas layers and a finished run), so only the
// data it reads (rounds, five_ghz_only, stats.gaps) is checked below.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { buildStraightEdges } from "../edges/straight";
import { CARD_ORDER, type EngineName } from "../scoreboard-model";
import { NON_HYBRID_SENTENCE, buildSteps } from "../tutor/sentences";
import { deriveFacts, type TutorEvent } from "../tutor/facts";
import { loadRecorded } from "../tutor/recorded";
import { PLAN_GROUP_LABEL, PLAN_TAG_TEXT } from "./scoreboard";

const BANNED = /faster|speed|wins|winner|beats/i;
const run = loadRecorded("hero_seed1");
const competitors: Record<string, any> = run?.result.competitors ?? {};

// ---------- data the map reads when it draws a plan ----------

describe("plan data in the recorded hero result", () => {
  it.skipIf(run === null)("each of the four plans has the data paintPlan draws from", () => {
    const ids = run!.request.points.map((p) => p.id);
    expect(Object.keys(competitors).sort()).toEqual([...CARD_ORDER].sort());
    for (const plan of CARD_ORDER) {
      const c = competitors[plan];
      expect(c.error, plan).toBeUndefined();
      const picked = c.rounds.flatMap((r: any) => r.picks as string[]);
      // Picked points and 5 GHz only points cover every point exactly once.
      expect(new Set(picked).size, plan).toBe(picked.length);
      expect([...picked, ...c.five_ghz_only].sort(), plan).toEqual([...ids].sort());
      expect(c.rounds.map((r: any) => r.channel), plan).toEqual([1, 6, 11]);
    }
  });

  it.skipIf(run === null)("only atoms alone marks gaps in this run", () => {
    expect(competitors.Atoms_Alone.stats.gaps.length).toBeGreaterThan(0);
    for (const plan of ["Hybrid", "Annealing_Rules", "Coin_Flip_Rules"]) {
      expect(competitors[plan].stats.gaps ?? [], plan).toEqual([]);
    }
  });

  it.skipIf(run === null)("the four plans differ, so a redraw is not the same picture", () => {
    const sig = CARD_ORDER.map((p) => JSON.stringify(competitors[p].rounds.map((r: any) => r.picks)));
    expect(new Set(sig).size).toBe(4);
  });
});

// ---------- browser harness ----------

let server: ViteDevServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let startError = "";

const HARNESS = `
import { createScoreboard } from '/src/screens/scoreboard.ts';
import { createStrip } from '/src/tutor/strip.ts';
import { deriveFacts } from '/src/tutor/facts.ts';
window.__h = { createScoreboard, createStrip, deriveFacts };
window.__ready = true;
`;

beforeAll(async () => {
  try {
    server = await createServer({
      logLevel: "silent",
      server: { port: 5290, strictPort: false, hmr: false },
    });
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

interface Snap {
  plan: string;
  checked: string | null;
  disabled: string | null;
  tab: number;
}

/** Build a fresh scoreboard in the page. `stage`: begin only, partial update, or finished. */
async function mount(p: Page, comps: Record<string, unknown>, stage: "begin" | "partial" | "finish", mode = "channel_plan") {
  await p.evaluate(
    ({ comps, stage, mode }) => {
      const W = window as any;
      W.__sel = [];
      const sb = W.__h.createScoreboard({
        onSelectPlan: (plan: string) => W.__sel.push(plan),
        onRunAgain: () => {},
        onBack: () => {},
        announce: () => {},
      });
      document.body.replaceChildren(sb.el);
      W.__sb = sb;
      sb.begin(1, mode);
      if (stage === "partial") sb.update({ Hybrid: comps.Hybrid });
      if (stage === "finish") sb.finish(comps);
    },
    { comps, stage, mode },
  );
}

const snap = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="radio"]')].map((r) => ({
      plan: r.dataset.plan!,
      checked: r.getAttribute("aria-checked"),
      disabled: r.getAttribute("aria-disabled"),
      tab: r.tabIndex,
    })),
  ) as Promise<Snap[]>;

const selected = (s: Snap[]) => s.filter((r) => r.checked === "true").map((r) => r.plan);
const active = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.plan ?? null);
const picks = (p: Page) => p.evaluate(() => (window as any).__sel as string[]);
const clickPlan = (p: Page, plan: string) =>
  p.evaluate((plan) => document.querySelector<HTMLElement>(`[role="radio"][data-plan="${plan}"]`)!.click(), plan);

// A small finished result for tests that do not need a recording.
function small(total: number): Record<string, unknown> {
  return {
    label: "simulation",
    rounds: [{ channel: 1, picks: Array.from({ length: total }, (_, i) => `p${i}`) }],
    stats: { total_picks: total, quantum_picks: 0, quantum_share: 0, splits: 0, skipped_tiles: 0, mismatches: 0, atoms_not_needed: true, gaps: [] },
  };
}
const smallAll = { Atoms_Alone: small(3), Hybrid: small(4), Annealing_Rules: small(5), Coin_Flip_Rules: small(6) };

describe("Plan_Selector radios (real Chromium)", () => {
  it("is a radiogroup labelled 'plan on the map' with one radio per card title", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "finish");
    const info = await p.evaluate(() => {
      const g = document.querySelector('[role="radiogroup"]')!;
      return { label: g.getAttribute("aria-label"), titles: [...g.querySelectorAll('[role="radio"]')].map((r) => r.textContent) };
    });
    expect(info.label).toBe(PLAN_GROUP_LABEL);
    expect(info.label).toBe("plan on the map");
    expect(info.titles).toEqual(["atoms alone", "atoms + rules (hybrid)", "annealing + rules", "coin flip + rules"]);
  });

  it("each of the four plans can be chosen and is reported by name", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "finish");
    for (const plan of ["Atoms_Alone", "Annealing_Rules", "Coin_Flip_Rules", "Hybrid"] as EngineName[]) {
      if (plan === "Hybrid") await clickPlan(p, "Annealing_Rules"); // leave Hybrid first, so the click below is a change
      await clickPlan(p, plan);
      expect(selected(await snap(p))).toEqual([plan]);
    }
    expect(await picks(p)).toEqual(["Atoms_Alone", "Annealing_Rules", "Coin_Flip_Rules", "Annealing_Rules", "Hybrid"]);
  });

  it("works with the real hero result: all four radios enabled", async (ctx) => {
    const p = need(ctx);
    if (run === null) ctx.skip("web/test-data/tutor/hero_seed1.json is missing");
    await mount(p, competitors, "finish");
    const s = await snap(p);
    expect(s.map((r) => r.disabled)).toEqual(["false", "false", "false", "false"]);
    const texts = await p.evaluate(() => [...document.querySelectorAll(".score-card")].map((c) => c.textContent));
    // Atoms alone shows the uncovered points in Details (5 in this run).
    expect(texts[0]).toMatch(/Points left uncovered\s*5/);
  });

  it("an error entry has a disabled radio and the reason stays as text", async (ctx) => {
    const p = need(ctx);
    await mount(p, { ...smallAll, Annealing_Rules: { error: "ValueError: bad 42" } }, "finish");
    const s = await snap(p);
    const bad = s.find((r) => r.plan === "Annealing_Rules")!;
    expect(bad.disabled).toBe("true");
    expect(bad.tab).toBe(-1);
    expect(s.filter((r) => r.plan !== "Annealing_Rules").map((r) => r.disabled)).toEqual(["false", "false", "false"]);
    const reason = await p.evaluate(() => {
      const r = document.querySelector('[data-plan="Annealing_Rules"]')!;
      const m = document.getElementById(r.getAttribute("aria-describedby") ?? "");
      return m?.textContent ?? null;
    });
    expect(reason).toContain("could not finish");
    expect(reason).not.toMatch(/\d/);
    await clickPlan(p, "Annealing_Rules");
    expect(await picks(p)).toEqual([]);
    expect(selected(await snap(p))).toEqual(["Hybrid"]);
  });

  it("arrow keys skip a disabled radio", async (ctx) => {
    const p = need(ctx);
    await mount(p, { ...smallAll, Annealing_Rules: { error: "x" } }, "finish");
    await p.evaluate(() => document.querySelector<HTMLElement>('[data-plan="Hybrid"]')!.focus());
    await p.keyboard.press("ArrowRight");
    expect(await active(p)).toBe("Coin_Flip_Rules");
    expect(selected(await snap(p))).toEqual(["Coin_Flip_Rules"]);
  });

  it("Hybrid is selected at the start of each run", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "finish");
    await clickPlan(p, "Coin_Flip_Rules");
    expect(selected(await snap(p))).toEqual(["Coin_Flip_Rules"]);
    await p.evaluate(() => (window as any).__sb.begin(2, "channel_plan"));
    expect(selected(await snap(p))).toEqual(["Hybrid"]);
    expect(await p.evaluate(() => (window as any).__sb.selectedPlan)).toBe("Hybrid");
    // and the first draw of a brand new scoreboard
    await mount(p, smallAll, "begin");
    expect(selected(await snap(p))).toEqual(["Hybrid"]);
  });

  it("radios are disabled while cards are pending, enabled after the result", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "begin");
    expect((await snap(p)).map((r) => r.disabled)).toEqual(["true", "true", "true", "true"]);
    await clickPlan(p, "Annealing_Rules");
    expect(await picks(p)).toEqual([]);

    // One card ready, three pending: still nothing can be chosen (the run is not over).
    await mount(p, smallAll, "partial");
    expect((await snap(p)).map((r) => r.disabled)).toEqual(["true", "true", "true", "true"]);
    await clickPlan(p, "Hybrid");
    await p.evaluate(() => document.querySelector<HTMLElement>('[data-plan="Hybrid"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(await picks(p)).toEqual([]);
    expect(selected(await snap(p))).toEqual(["Hybrid"]);

    await p.evaluate((c) => (window as any).__sb.finish(c), smallAll);
    expect((await snap(p)).map((r) => r.disabled)).toEqual(["false", "false", "false", "false"]);
  });

  it("arrow keys move and select, and wrap at both ends", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "finish");
    // Roving tabindex: exactly one tab stop, on the selected radio.
    let s = await snap(p);
    expect(s.filter((r) => r.tab === 0).map((r) => r.plan)).toEqual(["Hybrid"]);

    await p.evaluate(() => document.querySelector<HTMLElement>('[data-plan="Hybrid"]')!.focus());
    await p.keyboard.press("ArrowRight");
    expect(await active(p)).toBe("Annealing_Rules");
    expect(selected(await snap(p))).toEqual(["Annealing_Rules"]);
    await p.keyboard.press("ArrowDown");
    expect(selected(await snap(p))).toEqual(["Coin_Flip_Rules"]);
    await p.keyboard.press("ArrowRight"); // wraps to the first
    expect(await active(p)).toBe("Atoms_Alone");
    expect(selected(await snap(p))).toEqual(["Atoms_Alone"]);
    await p.keyboard.press("ArrowLeft"); // wraps to the last
    expect(await active(p)).toBe("Coin_Flip_Rules");
    expect(selected(await snap(p))).toEqual(["Coin_Flip_Rules"]);
    await p.keyboard.press("ArrowUp");
    expect(selected(await snap(p))).toEqual(["Annealing_Rules"]);

    s = await snap(p);
    expect(s.filter((r) => r.tab === 0).map((r) => r.plan)).toEqual(["Annealing_Rules"]);
    expect(await picks(p)).toEqual(["Annealing_Rules", "Coin_Flip_Rules", "Atoms_Alone", "Coin_Flip_Rules", "Annealing_Rules"]);
  });

  it("Space and Enter select the focused radio", async (ctx) => {
    const p = need(ctx);
    await mount(p, smallAll, "finish");
    await p.evaluate(() => document.querySelector<HTMLElement>('[data-plan="Atoms_Alone"]')!.focus());
    await p.keyboard.press("Space");
    expect(selected(await snap(p))).toEqual(["Atoms_Alone"]);
    await p.evaluate(() => document.querySelector<HTMLElement>('[data-plan="Coin_Flip_Rules"]')!.focus());
    await p.keyboard.press("Enter");
    expect(selected(await snap(p))).toEqual(["Coin_Flip_Rules"]);
  });

  it("only the selected card shows the 'on the map' tag; no banned words anywhere", async (ctx) => {
    const p = need(ctx);
    await mount(p, run === null ? smallAll : competitors, "finish");
    const tags = () =>
      p.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".score-card")].map((c) => {
          const t = c.querySelector<HTMLElement>(".plan-tag");
          return { text: t?.textContent ?? null, hidden: t?.hidden ?? null, selected: (c as HTMLElement).dataset.selected };
        }),
      );
    expect(PLAN_TAG_TEXT).toBe("on the map");
    let t = await tags();
    expect(t.map((x) => !x.hidden)).toEqual([false, true, false, false]);
    expect(t.map((x) => x.selected)).toEqual(["false", "true", "false", "false"]);
    expect(t.every((x) => x.text === "on the map")).toBe(true);

    await clickPlan(p, "Atoms_Alone");
    t = await tags();
    expect(t.map((x) => !x.hidden)).toEqual([true, false, false, false]);

    for (const plan of ["Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules"]) {
      await clickPlan(p, plan);
      const text = await p.evaluate(() => document.body.textContent ?? "");
      expect(text).not.toMatch(BANNED);
    }
  });

  it("a pending or error scoreboard has no banned words either", async (ctx) => {
    const p = need(ctx);
    await mount(p, { ...smallAll, Coin_Flip_Rules: { error: "boom" } }, "begin");
    expect(await p.evaluate(() => document.body.textContent ?? "")).not.toMatch(BANNED);
    await p.evaluate((c) => (window as any).__sb.finish(c), { ...smallAll, Coin_Flip_Rules: { error: "boom" } });
    expect(await p.evaluate(() => document.body.textContent ?? "")).not.toMatch(BANNED);
  });
});

describe("Tutor strip with the plan (real Chromium)", () => {
  async function mountStrip(p: Page) {
    const edges = buildStraightEdges(run!.request.points, run!.request.graph?.r ?? 0);
    await p.evaluate(
      ({ run, edges }) => {
        const W = window as any;
        W.__rings = [];
        const strip = W.__h.createStrip({ onRing: (ids: string[]) => W.__rings.push(ids) });
        document.body.replaceChildren(strip.el);
        W.__strip = strip;
        const facts = W.__h.deriveFacts({
          mode: run.request.mode,
          seed: run.request.seed,
          ids: run.request.points.map((q: any) => q.id),
          edges,
          events: run.events,
          result: run.result,
        });
        W.__facts = facts;
        strip.showFinished("The run is finished. These results are a simulation.", facts, "Hybrid", false);
      },
      { run: run!, edges },
    );
  }
  const view = (p: Page) =>
    p.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(s)!;
      const W = window as any;
      return {
        first: q(".tutor-first").textContent,
        body: q(".tutor-body").textContent,
        counter: q(".tutor-counter").textContent,
        controlsHidden: q(".tutor-controls").hidden,
        backToStepHidden: q(".tutor-back-to-step").hidden,
        lastRing: W.__rings[W.__rings.length - 1] as string[],
      };
    });

  it("non-Hybrid: one sentence, no steps, no ring, no why; back to Hybrid: Step 1 again", async (ctx) => {
    const p = need(ctx);
    if (run === null) ctx.skip("web/test-data/tutor/hero_seed1.json is missing");
    const facts = deriveFacts({
      mode: run!.request.mode,
      seed: run!.request.seed,
      ids: run!.request.points.map((q) => q.id),
      edges: buildStraightEdges(run!.request.points, run!.request.graph?.r ?? 0),
      events: run!.events as TutorEvent[],
      result: run!.result as any,
    });
    const step1 = buildSteps(facts, "Hybrid")[0];
    const total = buildSteps(facts, "Hybrid").length;
    await mountStrip(p);

    let v = await view(p);
    expect(v.body).toBe(step1.sentences.join(" "));
    expect(v.counter).toBe(`step 1 of ${total}`);
    expect(v.controlsHidden).toBe(false);
    expect(v.lastRing).toEqual(step1.ring);

    // Go to Step 3, then pick another plan.
    await p.click(".tutor-next");
    await p.click(".tutor-next");
    expect((await view(p)).counter).toBe(`step 3 of ${total}`);

    for (const plan of ["Atoms_Alone", "Annealing_Rules", "Coin_Flip_Rules"]) {
      await p.evaluate((plan) => (window as any).__strip.setPlan(plan), plan);
      v = await view(p);
      expect(v.first).toBe("The run is finished. These results are a simulation.");
      expect(v.body).toBe(NON_HYBRID_SENTENCE);
      expect(v.controlsHidden).toBe(true);
      expect(v.lastRing).toEqual([]);
      // A Why_Answer is not available outside Hybrid.
      const anyId = run!.request.points[0].id;
      await p.evaluate((id) => (window as any).__strip.showWhy(id), anyId);
      v = await view(p);
      expect(v.body).toBe(NON_HYBRID_SENTENCE);
      expect(v.backToStepHidden).toBe(true);
      expect(v.lastRing).toEqual([]);
    }

    await p.evaluate(() => (window as any).__strip.setPlan("Hybrid"));
    v = await view(p);
    expect(v.body).toBe(step1.sentences.join(" "));
    expect(v.counter).toBe(`step 1 of ${total}`);
    expect(v.controlsHidden).toBe(false);
    expect(v.lastRing).toEqual(step1.ring);
    expect(v.body).not.toMatch(BANNED);
  });
});
