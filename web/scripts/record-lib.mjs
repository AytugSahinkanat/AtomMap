// Pure parts of the results recorder (ui spec, task 16.2). No browser, no file or
// network access here, so vitest can test them. The node script record-results.mjs
// only wires these to Playwright.
//
// Honesty: every run goes in the file. A run is "ok", "bad" (a check failed) or
// "failed" (error or the 10 minute limit). Nothing is retried, removed or replaced.
// No durations are recorded anywhere.

export const COMPETITORS = ["Atoms_Alone", "Hybrid", "Annealing_Rules", "Coin_Flip_Rules"];

/** Map names exactly as the Results_Page and the example file use them. */
export const MAPS = ["Wifi hall", "Wifi hall, sparse control", "Kadıköy, Istanbul"];

/** Seeds 1 to 10, fixed in advance. */
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** The run order, which is also the file order: maps in order, seeds 1 to 10 for each. */
export function planRuns() {
  const out = [];
  for (const map of MAPS) for (const seed of SEEDS) out.push({ map, seed });
  return out;
}

/** Same rounding as formatPercent in scoreboard-model.ts: a percent with one decimal. */
export function percentOne(fraction) {
  return Math.round(fraction * 1000) / 10;
}

/** App commit text: the hash, plus " dirty" when `git status --porcelain` printed anything. */
export function commitLabel(hash, porcelain) {
  const h = String(hash).trim();
  return String(porcelain).trim() === "" ? h : `${h} dirty`;
}

/** Reads `NAME = number` from a Python source text. Throws if it is not there. */
export function readPyNumber(source, name) {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9][0-9._e+-]*)\\s*(?:#.*)?$`, "m").exec(source);
  if (!m) throw new Error(`constant ${name} not found in the engine source`);
  const n = Number(m[1]);
  if (!Number.isFinite(n)) throw new Error(`constant ${name} is not a number in the engine source`);
  return n;
}

/**
 * The checks of one Competitor result against the request that produced it:
 *  - known ids: every id in every Round is a point of the request
 *  - shared edge: no two picked points of one Round share an edge of the request
 *  - double pick: no point is picked twice, in one Round or in two Rounds
 * Returns [{ competitor, check, ok, detail }] for the three checks.
 */
export function checkCompetitor(name, entry, request) {
  const known = new Set(request.points.map((p) => p.id));
  const edges = request.graph.edges ?? [];
  const rounds = Array.isArray(entry?.rounds) ? entry.rounds : null;
  const results = [];
  const add = (check, detail) => results.push({ competitor: name, check, ok: detail === null, detail: detail ?? "" });

  if (rounds === null) {
    for (const check of ["known ids", "shared edge", "double pick"]) add(check, "the result has no rounds list");
    return results;
  }

  let unknown = null;
  rounds.forEach((r, i) => {
    for (const id of r?.picks ?? []) {
      if (unknown === null && !known.has(id)) unknown = `round ${i + 1} has the id "${id}", which is not a point of the map`;
    }
  });
  add("known ids", unknown);

  let shared = null;
  rounds.forEach((r, i) => {
    const set = new Set(r?.picks ?? []);
    for (const [a, b] of edges) {
      if (shared === null && set.has(a) && set.has(b)) shared = `round ${i + 1} picked "${a}" and "${b}", which share an edge`;
    }
  });
  add("shared edge", shared);

  let double = null;
  const seen = new Map();
  rounds.forEach((r, i) => {
    for (const id of r?.picks ?? []) {
      if (double === null && seen.has(id)) {
        double = seen.get(id) === i
          ? `"${id}" is picked twice in round ${i + 1}`
          : `"${id}" is picked in round ${seen.get(id) + 1} and in round ${i + 1}`;
      }
      if (!seen.has(id)) seen.set(id, i);
    }
  });
  add("double pick", double);

  return results;
}

/** Plain one-line reason from an engine error value. */
export function plainReason(raw) {
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (raw && typeof raw === "object" && typeof raw.message === "string") text = raw.message;
  text = text.split("\n")[0].replace(/^[A-Za-z_]+:\s*/, "").replace(/\s+/g, " ").trim();
  if (text.length > 200) text = text.slice(0, 200) + "...";
  return text || "no reason was given";
}

function zeroMap() {
  return Object.fromEntries(COMPETITORS.map((n) => [n, 0]));
}

/** A failed run: no numbers, a reason. Used for errors, crashes and the time limit. */
export function failedRecord(map, seed, reason) {
  return {
    seed,
    map,
    picks: zeroMap(),
    quantum_share: zeroMap(),
    atoms_not_needed: false,
    splits: 0,
    skipped_tiles: 0,
    status: "failed",
    reason,
  };
}

/**
 * Builds the Run_Record of one run and the list of checks that were run.
 * `outcome` is { error: text } when the worker failed, else { result } with
 * result.competitors (the engine's result object, or at least rounds and stats).
 * Returns { record, checks }.
 */
export function assembleRecord({ map, seed, request, outcome }) {
  if (outcome.error !== undefined) {
    return { record: failedRecord(map, seed, plainReason(outcome.error)), checks: [] };
  }
  const competitors = outcome.result?.competitors ?? {};

  for (const name of COMPETITORS) {
    const entry = competitors[name];
    if (entry === undefined || entry === null) {
      return { record: failedRecord(map, seed, `${name} returned no result`), checks: [] };
    }
    if (typeof entry === "object" && "error" in entry) {
      return { record: failedRecord(map, seed, `${name} could not finish: ${plainReason(entry.error)}`), checks: [] };
    }
    const total = entry.stats?.total_picks;
    const share = entry.stats?.quantum_share;
    if (!Number.isInteger(total) || total < 0 || typeof share !== "number" || !Number.isFinite(share)) {
      return { record: failedRecord(map, seed, `${name} returned stats without total_picks or quantum_share`), checks: [] };
    }
  }

  const picks = {};
  const quantum_share = {};
  for (const name of COMPETITORS) {
    picks[name] = competitors[name].stats.total_picks;
    quantum_share[name] = percentOne(competitors[name].stats.quantum_share);
  }
  const hybrid = competitors.Hybrid.stats;
  const record = {
    seed,
    map,
    picks,
    quantum_share,
    // The Hybrid's own numbers (see the protocol text).
    atoms_not_needed: hybrid.atoms_not_needed === true,
    splits: Number.isInteger(hybrid.splits) ? hybrid.splits : 0,
    skipped_tiles: Number.isInteger(hybrid.skipped_tiles) ? hybrid.skipped_tiles : 0,
    status: "ok",
  };

  const checks = COMPETITORS.flatMap((name) => checkCompetitor(name, competitors[name], request));
  const bad = checks.find((c) => !c.ok);
  if (bad) {
    record.status = "bad";
    record.reason = `${bad.competitor} failed the check "${bad.check}": ${bad.detail}`;
  }
  return { record, checks };
}

export const PROTOCOL_TEXT =
  "Fixed before any run. " +
  "Where: the built site, in Chromium driven by Playwright, with the same worker.js and Pyodide a visitor gets. One worker, runs one after the other. " +
  "Maps, in this order: Wifi hall (walls off), Wifi hall, sparse control (walls off), and Kadıköy, Istanbul (walking distance). " +
  "Seeds 1 to 10 for each map, 30 runs in total, in that order. The order of the runs in this file is the order they were made. " +
  "Settings: the app defaults and all four competitors in one request. Shots, steps, tile size and top group share are read from the engine source. " +
  "Each request is built by the app's own request builder, so it is what the page sends. The sparse hall is not in the page, so its request is built the same way from its fixture file. " +
  "Every run is in this file. A run that errors, or runs longer than 10 minutes, is marked failed with the reason. A competitor that returns an error also makes the run failed. " +
  "Nothing is retried, removed or replaced. If a run goes over 10 minutes the worker is stopped and a new one is started for the next run. " +
  "Each result is checked before it is written: every round has only known point ids, no two picked points of a round share an edge of the request, and no point is picked in two rounds. A run that fails a check is marked bad, with the competitor and the check named. " +
  "Picks are the total picks over all rounds. Quantum share is the percent of picks that came from the atoms, with one decimal. " +
  "The columns atoms not needed, splits and skipped tiles are the hybrid's. " +
  "No durations are recorded. All results are simulation.";

/** Plain protocol settings object from the engine constants. */
export function buildSettings(engine) {
  return {
    shots: engine.shots,
    steps: engine.steps,
    tile_size: engine.tile_size,
    top_group_share: engine.top_group_share,
    seeds: [...SEEDS],
    maps: {
      [MAPS[0]]: "walls off",
      [MAPS[1]]: "walls off",
      [MAPS[2]]: "walking distance",
    },
    competitors: [...COMPETITORS],
    app_settings: "defaults",
  };
}

/** The whole results file. Same shape as ResultsFile in web/src/data/results.ts. */
export function assembleFile({ settings, runs, date, commit, chromium, pyodide }) {
  return {
    example: false,
    protocol: { text: PROTOCOL_TEXT, settings },
    date,
    commit,
    chromium,
    pyodide,
    runs,
  };
}
