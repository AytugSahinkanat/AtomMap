// Tests for the Your map text parser (ui requirement 8.10 to 8.12, task 13.4).
import { describe, expect, it } from "vitest";
import { MAX_TEXT_BYTES } from "../settings";
import { detectKind, parseMapText, projectLatLon } from "./custom-map";

const LIMIT = 50;

function good(text: string, kind: "csv" | "geojson" = "csv", limit = LIMIT) {
  const r = parseMapText(text, kind, limit);
  if (!r.ok) throw new Error(`expected a good file, got: ${r.reason}`);
  return r.points;
}
function bad(text: string, kind: "csv" | "geojson" = "csv", limit = LIMIT): string {
  const r = parseMapText(text, kind, limit);
  if (r.ok) throw new Error("expected a reason, got points");
  return r.reason;
}

describe("CSV: good files", () => {
  it("reads comma separated values", () => {
    expect(good("id,x,y\na,1,2\nb,3.5,-4.25\n")).toEqual([
      { id: "a", x: 1, y: 2 },
      { id: "b", x: 3.5, y: -4.25 },
    ]);
  });
  it("reads semicolons and tabs, a byte order mark, CRLF and blank lines", () => {
    const expected = [{ id: "a", x: 1, y: 2 }];
    expect(good("id;x;y\na;1;2")).toEqual(expected);
    expect(good("id\tx\ty\na\t1\t2")).toEqual(expected);
    expect(good("\uFEFFid,x,y\r\n\r\na,1,2\r\n\r\n")).toEqual(expected);
  });
  it("finds columns by name in any order and ignores other columns", () => {
    expect(good("Y,name,X,ID\n2,foo,1,a")).toEqual([{ id: "a", x: 1, y: 2 }]);
  });
  it("reads an AtomMap CSV export back, with a quoted id", () => {
    const text = 'id,x,y,round,result_label,seed\n"a,1",1.5,2.5,1,simulation,1\n"say ""hi""",3,4,not picked,simulation,1\n';
    expect(good(text)).toEqual([
      { id: "a,1", x: 1.5, y: 2.5 },
      { id: 'say "hi"', x: 3, y: 4 },
    ]);
  });
  it("accepts exactly the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `p${i},${i},0`).join("\n");
    expect(good(`id,x,y\n${rows}`, "csv", 5)).toHaveLength(5);
  });
});

describe("CSV: bad files give a reason and no points", () => {
  it("names the missing column and what the first line has", () => {
    expect(bad("name,lat,lon\na,1,2")).toBe("The first line must name the columns id, x and y. It has: name, lat, lon.");
    expect(bad("id,x\na,1")).toContain("id, x");
  });
  it("explains a comma decimal with its line", () => {
    expect(bad("id;x;y\na;1;2\nb;12,5;3")).toBe('Line 3: x is not a number ("12,5"). Write decimals with a dot.');
  });
  it("names a value that is not a number, an empty value and an empty id", () => {
    expect(bad("id,x,y\na,one,2")).toBe('Line 2: x is not a number ("one").');
    expect(bad("id,x,y\na,1")).toBe("Line 2: there is no value for y.");
    expect(bad("id,x,y\n,1,2")).toBe("Line 2: the id is empty.");
  });
  it("refuses numbers beyond 1,000,000 m", () => {
    expect(bad("id,x,y\na,2000000,2")).toContain("1,000,000 m");
  });
  it("names duplicate ids", () => {
    expect(bad("id,x,y\na,1,2\nb,3,4\na,5,6")).toBe("The id a is used twice.");
    expect(bad("id,x,y\na,1,2\na,3,4\nb,5,6\nb,7,8")).toBe("These ids are used more than once: a, b.");
  });
  it("refuses an empty file, blank text and a header with no rows", () => {
    expect(bad("")).toBe("There are no points in this text.");
    expect(bad("  \n \n")).toBe("There are no points in this text.");
    expect(bad("id,x,y\n")).toBe("There are no points in this text.");
  });
  it("refuses more points than the limit and says how many", () => {
    const rows = Array.from({ length: 6 }, (_, i) => `p${i},${i},0`).join("\n");
    expect(bad(`id,x,y\n${rows}`, "csv", 5)).toBe("There are 6 points. The limit is 5.");
  });
  it("refuses text over 1 MB", () => {
    expect(bad("x".repeat(MAX_TEXT_BYTES + 1))).toBe("The text is larger than 1 MB.");
  });
});

describe("GeoJSON: good files", () => {
  // Expected numbers were computed with centroid() and project() of scripts/fetch_place.py, then centred by hand:
  // points (lat, lon) (41.0, 29.0), (41.0003, 29.0004), (41.0005, 29.0002) -> centroid (41.000267, 29.0002)
  // -> metres (-16.8, -29.7), (16.8, 3.7), (0.0, 25.9). The box is x -16.8..16.8 and y -29.7..25.9,
  // so the shift to the middle of the 90 m x 60 m area (45, 30) is dx = 45.0 and dy = 31.9.
  const pt = (lon: number, lat: number, props: object | null = {}) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: props,
  });
  const collection = {
    type: "FeatureCollection",
    features: [pt(29.0, 41.0, { id: "west" }), pt(29.0004, 41.0003, null), pt(29.0002, 41.0005, { id: 7 })],
  };

  it("projects like fetch_place.py, centres the points in the drawing area and keeps lon and lat", () => {
    const pts = good(JSON.stringify(collection), "geojson");
    expect(pts).toEqual([
      { id: "west", x: 28.2, y: 2.2, lon: 29.0, lat: 41.0 },
      { id: "p001", x: 61.8, y: 35.6, lon: 29.0004, lat: 41.0003 },
      { id: "7", x: 45.0, y: 57.8, lon: 29.0002, lat: 41.0005 },
    ]);
  });
  it("puts the middle of the bounding box at the middle of the area (45, 30) and keeps every distance", () => {
    const pts = good(JSON.stringify(collection), "geojson");
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(45, 1);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(30, 1);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(90);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(60);
    }
    // Distances before the shift (from projectLatLon around the same origin) equal the distances after it.
    const origin = {
      lat: Math.round(((41.0 + 41.0003 + 41.0005) / 3) * 1e6) / 1e6, // the centroid, rounded to 6 decimals like fetch_place.py
      lon: Math.round(((29.0 + 29.0004 + 29.0002) / 3) * 1e6) / 1e6,
    };
    const raw = pts.map((p) => projectLatLon(p.lat!, p.lon!, origin.lat, origin.lon));
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const before = Math.hypot(raw[i].x - raw[j].x, raw[i].y - raw[j].y);
        const after = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(after).toBeCloseTo(before, 6); // every point moved by the same multiple of 0.1 m
      }
  });
  it("a set larger than the area is centred too and keeps its distances (it sticks out on all sides)", () => {
    const big = { type: "FeatureCollection", features: [pt(29.0, 41.0, { id: "a" }), pt(29.02, 41.01, { id: "b" })] };
    const [a, b] = good(JSON.stringify(big), "geojson");
    expect((a.x + b.x) / 2).toBeCloseTo(45, 1);
    expect((a.y + b.y) / 2).toBeCloseTo(30, 1);
    expect(b.x - a.x).toBeCloseTo(1678.3, 0); // 1007.0 - (-671.3), the projection of fetch_place.py
    expect(b.y - a.y).toBeCloseTo(1112.0, 0); // 667.2 - (-444.8)
  });
  it("reads a single Feature and a bare Point, a lone point lands in the middle of the area", () => {
    const f = pt(29, 41, { id: "solo" });
    expect(good(JSON.stringify(f), "geojson")).toEqual([{ id: "solo", x: 45, y: 30, lon: 29, lat: 41 }]);
    expect(good(JSON.stringify({ type: "Point", coordinates: [29, 41] }), "geojson")).toEqual([
      { id: "p001", x: 45, y: 30, lon: 29, lat: 41 },
    ]);
  });
  it("makes generated ids that skip the ids already used", () => {
    const c = { type: "FeatureCollection", features: [pt(29, 41, { id: "p001" }), pt(29.1, 41), pt(29.2, 41)] };
    expect(good(JSON.stringify(c), "geojson").map((p) => p.id)).toEqual(["p001", "p002", "p003"]);
  });
  it("projectLatLon (before centring) matches the script for a point at the origin", () => {
    expect(projectLatLon(41, 29, 41, 29)).toEqual({ x: 0, y: 0 });
  });
  it("CSV in metres is not moved", () => {
    expect(good("id,x,y\na,1000,-50")).toEqual([{ id: "a", x: 1000, y: -50 }]);
  });
});
describe("GeoJSON: bad files give a reason and no points", () => {
  const f = (geometry: unknown) => ({ type: "Feature", geometry, properties: {} });
  const col = (...features: unknown[]) => JSON.stringify({ type: "FeatureCollection", features });
  const point = { type: "Point", coordinates: [29, 41] };

  it("refuses a feature that is not a Point, by number", () => {
    expect(bad(col(f(point), f({ type: "LineString", coordinates: [[0, 0], [1, 1]] })), "geojson")).toBe(
      "Feature 2 is a LineString, not a Point. Only points can be used.",
    );
    expect(bad(col(f(point), f(null)), "geojson")).toBe("Feature 2 has no geometry. Only points can be used.");
  });
  it("refuses a whole file of another type", () => {
    expect(bad(JSON.stringify({ type: "Polygon", coordinates: [] }), "geojson")).toBe(
      "This GeoJSON is a Polygon, not points. Only points can be used.",
    );
    expect(bad("[1,2]", "geojson")).toBe("This is neither CSV nor GeoJSON.");
  });
  it("refuses invalid JSON, no features and bad coordinates", () => {
    expect(bad("{not json", "geojson")).toBe("This looks like GeoJSON, but it is not valid JSON.");
    expect(bad(col(), "geojson")).toBe("There are no points in this text.");
    expect(bad(col(f({ type: "Point", coordinates: [200, 41] })), "geojson")).toBe(
      "Feature 1 does not have a longitude and a latitude.",
    );
    expect(bad(col(f({ type: "Point", coordinates: ["a", "b"] })), "geojson")).toContain("Feature 1");
  });
  it("refuses duplicate ids and too many points", () => {
    const withId = (id: string) => ({ type: "Feature", geometry: point, properties: { id } });
    expect(bad(col(withId("a"), withId("a")), "geojson")).toBe("The id a is used twice.");
    expect(bad(col(f(point), f(point), f(point)), "geojson", 2)).toBe("There are 3 points. The limit is 2.");
  });
  it("refuses an empty file", () => {
    expect(bad("", "geojson")).toBe("There are no points in this text.");
  });
});

describe("detectKind", () => {
  it("uses the file name first, then the first character", () => {
    expect(detectKind("id,x,y", "map.geojson")).toBe("geojson");
    expect(detectKind("{}", "map.csv")).toBe("csv");
    expect(detectKind('  {"type":"Point"}')).toBe("geojson");
    expect(detectKind("id,x,y")).toBe("csv");
  });
  it("text that is neither: JSON-looking text read as CSV has no columns, plain text too", () => {
    expect(bad("hello world")).toContain("The first line must name the columns");
  });
});
