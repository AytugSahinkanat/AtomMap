// Your map on the shared parts: Tutor idle sentence, label, export and Scoreboard cards (ui task 13.8).
// A hand-made one-round result is used. No Worker and no browser.
import { describe, expect, it } from "vitest";
import { YOUR_MAP_LABEL_SUFFIX, yourMapLabel } from "./label";
import { CARD_ORDER, buildCardsFromResult, cardTexts } from "../scoreboard-model";
import { UNITS_LON_LAT, UNITS_METRES, buildCsv, buildGeoJson, exportFileName, type ExportInput } from "../export";
import { buildIdle } from "../tutor/sentences";

const BANNED = /faster|speed|wins|winner|beats/i;

function comp(picks: string[]) {
  return {
    label: "simulation",
    rounds: [{ channel: 1, picks }],
    stats: {
      total_picks: picks.length,
      quantum_picks: 1,
      quantum_share: picks.length ? 1 / picks.length : 0,
      atoms_not_needed: false,
      splits: 0,
      skipped_tiles: 0,
      mismatches: 0,
    },
  };
}
const result = {
  competitors: {
    Atoms_Alone: comp(["p001"]),
    Hybrid: comp(["p001", "p003"]),
    Annealing_Rules: comp(["p001", "p003"]),
    Coin_Flip_Rules: comp(["p002"]),
  },
};

describe("Tutor idle sentence", () => {
  const mine = buildIdle("place", "your_map");
  it("says point, not cafe and not access point, and has no banned word", () => {
    expect(mine[0]).toBe("Each dot is a point. A line joins two that are closer than r, so they can't both be picked.");
    for (const s of mine) {
      expect(/cafe|access point/i.test(s)).toBe(false);
      expect(BANNED.test(s)).toBe(false);
    }
  });
  it("keeps the second sentence and leaves the other two idle texts unchanged", () => {
    expect(mine[1]).toBe(buildIdle("place")[1]);
    expect(buildIdle("place")[0]).toBe("Each dot is a cafe. A line joins two that are too close to both be picked.");
    expect(buildIdle("channel_plan")[0]).toBe(
      "Each dot is a wifi access point. A line joins two that are too close to share a channel.",
    );
  });
});

describe("label", () => {
  it("reads: Your map, N points. Results are a simulation.", () => {
    expect(yourMapLabel(10)).toBe("Your map, 10 points. Results are a simulation.");
    expect(yourMapLabel(0)).toBe("Your map, 0 points. Results are a simulation.");
    expect(YOUR_MAP_LABEL_SUFFIX).toBe("Results are a simulation.");
  });
  it("says 1 point for one point", () => {
    expect(yourMapLabel(1)).toBe("Your map, 1 point. Results are a simulation.");
  });
});

describe("export of a Your map run", () => {
  const drawn: ExportInput = {
    result,
    plan: "Hybrid",
    mode: "place",
    map: "your-map",
    seed: 3,
    points: [
      { id: "p001", x: 1, y: 2 },
      { id: "p002", x: 3, y: 4 },
      { id: "p003", x: 5, y: 6 },
    ],
  };
  it("uses the map name your-map in the file names", () => {
    expect(exportFileName("your-map", "Hybrid", 3, "csv")).toBe("atommap-your-map-atoms-rules-hybrid-seed3.csv");
    expect(exportFileName("your-map", "Hybrid", -5, "geojson")).toBe("atommap-your-map-atoms-rules-hybrid-seedm5.geojson");
  });
  it("CSV: round is 1 or not picked, with the label and the seed", () => {
    const lines = buildCsv(drawn).trim().split("\n");
    expect(lines[0]).toBe("id,x,y,round,result_label,seed");
    expect(lines.slice(1)).toEqual(["p001,1,2,1,simulation,3", "p002,3,4,not picked,simulation,3", "p003,5,6,1,simulation,3"]);
  });
  it("GeoJSON of a drawn map is [x, y] in local metres", () => {
    const g = buildGeoJson(drawn);
    expect(g.units).toBe(UNITS_METRES);
    expect(g.features[0].geometry.coordinates).toEqual([1, 2]);
    expect(g.result_label).toBe("simulation");
    expect(g.seed).toBe(3);
  });
  it("GeoJSON of an imported map is [lon, lat] only when every point has both", () => {
    const withGeo: ExportInput = { ...drawn, points: drawn.points.map((p, i) => ({ ...p, lon: 29 + i / 100, lat: 41 })) };
    const g = buildGeoJson(withGeo);
    expect(g.units).toBe(UNITS_LON_LAT);
    expect(g.features[1].geometry.coordinates).toEqual([29.01, 41]);
    const mixed: ExportInput = { ...drawn, points: [{ ...drawn.points[0], lon: 29, lat: 41 }, ...drawn.points.slice(1)] };
    expect(buildGeoJson(mixed).units).toBe(UNITS_METRES);
  });
  it("each of the four plans can be exported", () => {
    for (const plan of CARD_ORDER) expect(buildCsv({ ...drawn, plan }).split("\n").length).toBeGreaterThan(3);
  });
});

describe("Scoreboard cards for a Your map result", () => {
  it("gives four ready cards with the quantum share and the simulation label, and no banned word", () => {
    const cards = buildCardsFromResult(result);
    expect(cards.map((c) => c.key)).toEqual([...CARD_ORDER]);
    expect(cards.every((c) => c.state === "ready")).toBe(true);
    for (const c of cards) for (const t of cardTexts(c)) expect(BANNED.test(t)).toBe(false);
    const text = cards.flatMap((c) => cardTexts(c)).join(" ");
    expect(text).toContain("simulation");
  });
});
