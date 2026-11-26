// Example tests of the scene routes (experience spec, Requirement 1). The round-trip property is task 15.1.
import { describe, expect, it } from "vitest";
import { formatRoute, MAP_SLUGS, parseRoute } from "./router";

describe("scene routes", () => {
  it("reads every scene of every map and writes it back", () => {
    for (const map of MAP_SLUGS) {
      for (const scene of ["map", "run", "results", "lab"] as const) {
        const r = { scene, map };
        expect(parseRoute(formatRoute(r))).toEqual(r);
      }
    }
    expect(formatRoute({ scene: "map", map: "hall" })).toBe("#/map/hall");
    expect(formatRoute({ scene: "run", map: "hall" })).toBe("#/map/hall/run");
    expect(formatRoute({ scene: "choose" })).toBe("#/");
  });

  it("keeps #/results as the What we measured page", () => {
    expect(parseRoute("#/results")).toEqual({ scene: "measured" });
    expect(formatRoute({ scene: "measured" })).toBe("#/results");
  });

  it("sends anything unknown to the Choose_Scene", () => {
    for (const h of ["", "#", "#/", "#/map", "#/map/", "#/map/paris", "#/map/hall/edit", "#/map/hall/run/x", "#/RESULTS", "#map/hall"]) {
      expect(parseRoute(h), h).toEqual({ scene: "choose" });
    }
  });

  it("accepts a trailing slash and a hash without #", () => {
    expect(parseRoute("#/map/kadikoy/")).toEqual({ scene: "map", map: "kadikoy" });
    expect(parseRoute("/map/your-map/results")).toEqual({ scene: "results", map: "your-map" });
  });
});
