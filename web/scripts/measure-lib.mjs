// Pure parts of web/scripts/measure-limit.mjs (ui spec, task 13.9). No browser, no files.
// The settings are fixed here before the first measurement (honesty rule 8) and match the table
// "Point limit: how it is measured" in .kiro/specs/ui/design.md.

/** Sizes (number of points) of the measurement plan. */
export const SIZES = [25, 50, 100, 150, 200, 300];

/** Layouts: the same random points, with a different conflict radius r in metres. */
export const LAYOUTS = [
  { name: "dense", r: 20 },
  { name: "mid", r: 10 },
  { name: "sparse", r: 5 },
];

/** Layout seeds. The points of size n are the first n points drawn by mulberry32(layout seed). */
export const LAYOUT_SEEDS = [1, 2, 3];

/** The run seed (DEFAULT_SEED of the app). */
export const RUN_SEED = 1;

/** The warm-up run: not counted. */
export const WARMUP = { size: 20, layout: "dense", layoutSeed: 1 };

/** A run is within the limit when it finished without an error in at most this many seconds. */
export const LIMIT_SECONDS = 60;

/** After a size in which any run took longer than this, the larger sizes are not run. */
export const STOP_SECONDS = 180;

/** One run must finish within this many seconds, or it counts as failed. */
export const TIMEOUT_SECONDS = 300;

/** The plan, in the order the runs are made. */
export function planRuns() {
  const runs = [];
  for (const size of SIZES)
    for (const layout of LAYOUTS)
      for (const layoutSeed of LAYOUT_SEEDS) runs.push({ size, layout: layout.name, r: layout.r, layoutSeed });
  return runs;
}

/** True when this run is inside the limit: finished, no error, at most LIMIT_SECONDS. */
export function withinLimit(run) {
  return run.ok === true && run.seconds <= LIMIT_SECONDS;
}

/** True when the sizes after this one should not be run. */
export function shouldStopAfter(runsOfSize) {
  return runsOfSize.some((r) => !(r.seconds <= STOP_SECONDS));
}

/**
 * The Point_Limit by the rule of the design: the largest size S in the plan for which every run of S
 * and of every smaller size finished without an error in LIMIT_SECONDS or less.
 * Returns null when even the smallest size does not qualify. Sizes with no run count as not qualified.
 */
export function computeLimit(runs, sizes = SIZES) {
  let limit = null;
  for (const size of sizes) {
    const of = runs.filter((r) => r.size === size);
    if (of.length === 0 || !of.every(withinLimit)) break;
    limit = size;
  }
  return limit;
}

const fmt = (r) => (r.ok ? r.seconds.toFixed(1) : `${r.seconds.toFixed(1)} (${r.reason ?? "failed"})`);

/** A Markdown table: one row per size, one column per layout, the times of the layout seeds and the largest. */
export function formatTable(runs, sizes = SIZES, layouts = LAYOUTS) {
  const lines = [
    `| Points | ${layouts.map((l) => `${l.name} (r ${l.r} m), seconds for layout seeds ${LAYOUT_SEEDS.join("/")}`).join(" | ")} | Slowest |`,
    `|---|${layouts.map(() => "---").join("|")}|---|`,
  ];
  for (const size of sizes) {
    const of = runs.filter((r) => r.size === size);
    if (of.length === 0) {
      lines.push(`| ${size} | ${layouts.map(() => "not run").join(" | ")} | not run |`);
      continue;
    }
    const cells = layouts.map((l) => {
      const mine = of.filter((r) => r.layout === l.name);
      return mine.length === 0 ? "not run" : mine.map(fmt).join(" / ");
    });
    const slowest = of.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    lines.push(`| ${size} | ${cells.join(" | ")} | ${slowest.seconds.toFixed(1)} (${slowest.layout}) |`);
  }
  return lines.join("\n");
}
