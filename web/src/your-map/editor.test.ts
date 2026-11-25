// Tests for the Your map editor logic (ui requirement 8.3 to 8.7, task 13.5).
import { describe, expect, it } from "vitest";
import { buildStraightEdges } from "../edges/straight";
import { RANDOM_BATCH, START_RING_POINTS, START_RING_RADIUS_M, YOUR_MAP_AREA_M, YOUR_R_DEFAULT } from "../settings";
import {
  addPoint,
  addRandom,
  clearMap,
  clickAt,
  emptyMap,
  formatId,
  limitMessage,
  mulberry32,
  parseR,
  randomFor,
  removePoint,
  replaceMap,
  startingRing,
} from "./editor";

const LIMIT = 300;

describe("add", () => {
  it("adds a point rounded to 0.1 m with the next id", () => {
    const r = addPoint(emptyMap(), 12.34, 56.78, LIMIT);
    expect(r.message).toBeNull();
    expect(r.state.points).toEqual([{ id: "p001", x: 12.3, y: 56.8 }]);
    expect(addPoint(r.state, 1, 2, LIMIT).state.points[1].id).toBe("p002");
  });
  it("refuses a spot outside the area and leaves the map as it was", () => {
    const s = emptyMap();
    for (const [x, y] of [[-0.1, 5], [5, -0.1], [YOUR_MAP_AREA_M.width + 0.1, 5], [5, YOUR_MAP_AREA_M.height + 0.1]]) {
      const r = addPoint(s, x, y, LIMIT);
      expect(r.state).toBe(s);
      expect(r.message).toContain("outside");
    }
  });
  it("accepts the corners of the area", () => {
    expect(addPoint(emptyMap(), 0, 0, LIMIT).message).toBeNull();
    expect(addPoint(emptyMap(), YOUR_MAP_AREA_M.width, YOUR_MAP_AREA_M.height, LIMIT).message).toBeNull();
  });
  it("refuses at the limit with the message", () => {
    let s = emptyMap();
    for (let i = 0; i < 3; i++) s = addPoint(s, i, i, 3).state;
    const r = addPoint(s, 9, 9, 3);
    expect(r.state).toBe(s);
    expect(r.message).toBe(limitMessage(3));
    expect(r.message).toBe("The limit is 3 points. Remove some to add more.");
  });
});

describe("remove", () => {
  it("removes only the point with that id", () => {
    let s = emptyMap();
    for (let i = 0; i < 3; i++) s = addPoint(s, i, i, LIMIT).state;
    const t = removePoint(s, "p002");
    expect(t.points.map((p) => p.id)).toEqual(["p001", "p003"]);
    expect(s.points).toHaveLength(3); // the old state is not changed
  });
  it("never reuses an id after a remove", () => {
    let s = addPoint(emptyMap(), 1, 1, LIMIT).state;
    s = removePoint(s, "p001");
    s = addPoint(s, 2, 2, LIMIT).state;
    expect(s.points.map((p) => p.id)).toEqual(["p002"]);
  });
  it("an unknown id changes nothing", () => {
    const s = addPoint(emptyMap(), 1, 1, LIMIT).state;
    expect(removePoint(s, "nope").points).toEqual(s.points);
  });
});

describe("clear", () => {
  it("empties the map and starts the ids again", () => {
    let s = addPoint(emptyMap(), 1, 1, LIMIT).state;
    s = addPoint(s, 2, 2, LIMIT).state;
    const c = clearMap(s);
    expect(c.points).toEqual([]);
    expect(addPoint(c, 3, 3, LIMIT).state.points[0].id).toBe("p001");
  });
});

describe("random", () => {
  it("adds the batch inside the area, rounded to 0.1 m, with a fixed generator", () => {
    const a = addRandom(emptyMap(), RANDOM_BATCH, mulberry32(1), LIMIT);
    const b = addRandom(emptyMap(), RANDOM_BATCH, mulberry32(1), LIMIT);
    expect(a.message).toBeNull();
    expect(a.state.points).toHaveLength(RANDOM_BATCH);
    expect(a.state.points).toEqual(b.state.points); // same generator, same points
    for (const p of a.state.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(YOUR_MAP_AREA_M.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(YOUR_MAP_AREA_M.height);
      expect(Math.round(p.x * 10) / 10).toBe(p.x);
      expect(Math.round(p.y * 10) / 10).toBe(p.y);
    }
    expect(a.state.points.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => formatId(i + 1)));
  });
  it("the same press gives the same points, different presses give different points", () => {
    const one = addRandom(emptyMap(), 10, randomFor(1), LIMIT).state.points;
    const again = addRandom(emptyMap(), 10, randomFor(1), LIMIT).state.points;
    const two = addRandom(emptyMap(), 10, randomFor(2), LIMIT).state.points;
    expect(again).toEqual(one);
    expect(two).not.toEqual(one);
  });
  it("adds fewer near the limit and says how many", () => {
    let s = emptyMap();
    for (let i = 0; i < 7; i++) s = addPoint(s, i, i, 10).state;
    const r = addRandom(s, 10, mulberry32(2), 10);
    expect(r.state.points).toHaveLength(10);
    expect(r.message).toBe("Added 3 of 10 points. The limit is 10 points.");
  });
  it("adds nothing at the limit and says so", () => {
    let s = emptyMap();
    for (let i = 0; i < 3; i++) s = addPoint(s, i, i, 3).state;
    const r = addRandom(s, 10, mulberry32(2), 3);
    expect(r.state).toBe(s);
    expect(r.message).toBe(limitMessage(3));
  });
  it("continues the ids after the points that are there", () => {
    const s = addPoint(emptyMap(), 1, 1, LIMIT).state;
    expect(addRandom(s, 2, mulberry32(3), LIMIT).state.points.map((p) => p.id)).toEqual(["p001", "p002", "p003"]);
  });
});

describe("replaceMap", () => {
  it("keeps generated ids clear of imported p<number> ids", () => {
    const s = replaceMap([
      { id: "p007", x: 1, y: 1 },
      { id: "cafe", x: 2, y: 2 },
      { id: "p003", x: 3, y: 3 },
    ]);
    expect(s.nextId).toBe(8);
    expect(addPoint(s, 5, 5, LIMIT).state.points[3].id).toBe("p008");
  });
  it("starts at p001 when no imported id looks like one", () => {
    expect(replaceMap([{ id: "a", x: 1, y: 1 }]).nextId).toBe(1);
  });
  it("copies the points and keeps lon and lat", () => {
    const src = [{ id: "a", x: 1, y: 1, lon: 29, lat: 41 }];
    const s = replaceMap(src);
    expect(s.points).toEqual(src);
    expect(s.points[0]).not.toBe(src[0]);
  });
});

describe("clickAt", () => {
  it("removes the point that was hit", () => {
    const s = addPoint(emptyMap(), 10, 10, LIMIT).state;
    const r = clickAt(s, 10, 10, "p001", LIMIT);
    expect(r.state.points).toEqual([]);
    expect(r.message).toBeNull();
  });
  it("adds a point when nothing was hit", () => {
    const r = clickAt(emptyMap(), 10, 20, null, LIMIT);
    expect(r.state.points).toEqual([{ id: "p001", x: 10, y: 20 }]);
  });
});

describe("parseR", () => {
  it("accepts the ends of the range and numbers between", () => {
    expect(parseR("2")).toEqual({ ok: true, value: 2 });
    expect(parseR("200")).toEqual({ ok: true, value: 200 });
    expect(parseR(" 20.5 ")).toEqual({ ok: true, value: 20.5 });
  });
  it("refuses outside the range, empty text and words, with the plain message", () => {
    for (const t of ["1.9", "200.1", "", "  ", "abc", "NaN", "Infinity", "-5"]) {
      const r = parseR(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("r must be a number from 2 to 200 metres.");
    }
  });
});

describe("starting map", () => {
  const ring = startingRing();
  const edges = buildStraightEdges(ring.points, YOUR_R_DEFAULT);
  const neighbours = (id: string): string[] =>
    edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  const touch = (a: string, b: string): boolean => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  it("is 8 points on a circle of radius 15 m around the middle of the area, inside the area", () => {
    expect(ring.points).toHaveLength(START_RING_POINTS);
    expect(START_RING_POINTS).toBe(8);
    expect(START_RING_RADIUS_M).toBe(15);
    expect(YOUR_R_DEFAULT).toBe(20);
    for (const p of ring.points) {
      const d = Math.hypot(p.x - YOUR_MAP_AREA_M.width / 2, p.y - YOUR_MAP_AREA_M.height / 2);
      expect(Math.abs(d - 15)).toBeLessThanOrEqual(0.08); // the 0.1 m rounding of x and y
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(YOUR_MAP_AREA_M.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(YOUR_MAP_AREA_M.height);
    }
  });

  it("with r 20 it is a ring: every point has exactly 2 neighbours, and those two do not touch each other", () => {
    expect(edges).toHaveLength(START_RING_POINTS); // a ring of 8 has 8 edges
    for (const p of ring.points) {
      const n = neighbours(p.id);
      expect(n, p.id).toHaveLength(2);
      expect(touch(n[0], n[1]), `${p.id}: ${n.join(" and ")}`).toBe(false);
    }
  });

  it("the neighbours are the next points around the circle", () => {
    const ids = ring.points.map((p) => p.id);
    ids.forEach((id, k) => {
      const next = ids[(k + 1) % ids.length];
      expect(touch(id, next), `${id} and ${next}`).toBe(true);
    });
  });

  it("is always the same, has ids p001 to p008, and the next added point is p009", () => {
    expect(startingRing()).toEqual(ring);
    expect(ring.points.map((p) => p.id)).toEqual(["p001", "p002", "p003", "p004", "p005", "p006", "p007", "p008"]);
    expect(addPoint(ring, 1, 1, LIMIT).state.points[8].id).toBe("p009");
  });

  it("Clear empties it", () => {
    expect(clearMap(ring).points).toEqual([]);
  });
});