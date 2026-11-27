// Local_Progress (experience spec, Property 8 and task 10.5; Requirements 12.3, 12.5, 22.5).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_DAYS,
  PROGRESS_KEY,
  emptyProgress,
  loadProgress,
  progressLine,
  recordDaily,
  saveProgress,
  streak,
  type Progress,
  type ProgressStorage,
} from "./progress";

function memoryStorage(initial?: string): ProgressStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PROGRESS_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}
const throwing: ProgressStorage = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("full"); },
};

describe("loadProgress and saveProgress", () => {
  it("a storage that throws on read or write, or no storage, gives empty progress and never throws", () => {
    expect(loadProgress(throwing)).toEqual(emptyProgress());
    expect(() => saveProgress(throwing, recordDaily(emptyProgress(), "2026-12-04", 3))).not.toThrow();
    expect(loadProgress(null)).toEqual(emptyProgress());
    expect(() => saveProgress(null, emptyProgress())).not.toThrow();
    const readOnly: ProgressStorage = { getItem: () => null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
    expect(() => saveProgress(readOnly, emptyProgress())).not.toThrow();
  });

  it("wrong JSON and wrong shapes are treated as empty", () => {
    for (const raw of ["", "{", "null", "[]", "42", '"x"', '{"v":2,"days":{}}', '{"v":1}', '{"v":1,"days":[]}',
      '{"v":1,"days":{"2026-12-04":{"best":-1}}}', '{"v":1,"days":{"2026-12-04":{"best":1.5}}}',
      '{"v":1,"days":{"yesterday":{"best":1}}}', '{"v":1,"days":{"2026-12-04":{}}}', '{"v":1,"days":{"2026-12-04":7}}']) {
      expect(loadProgress(memoryStorage(raw)), raw).toEqual(emptyProgress());
    }
  });

  it("any stored string loads without throwing (Property 8)", () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const p = loadProgress(memoryStorage(raw));
      expect(p.v).toBe(1);
    }));
  });

  it("a well-formed progress round-trips", () => {
    const s = memoryStorage();
    let p: Progress = emptyProgress();
    p = recordDaily(p, "2026-12-03", 4);
    p = recordDaily(p, "2026-12-04", 2);
    p = recordDaily(p, "2026-12-04", 1); // lower: the larger one stays
    saveProgress(s, p);
    expect(loadProgress(s)).toEqual({ v: 1, days: { "2026-12-03": { best: 4 }, "2026-12-04": { best: 2 } } });
  });

  it("keeps the last 60 dates only", () => {
    const s = memoryStorage();
    let p = emptyProgress();
    for (let d = 0; d < 75; d++) p = recordDaily(p, new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10), d);
    saveProgress(s, p);
    const back = loadProgress(s);
    const keys = Object.keys(back.days).sort();
    expect(keys).toHaveLength(MAX_DAYS);
    expect(keys[0]).toBe(new Date(Date.UTC(2026, 0, 16)).toISOString().slice(0, 10));
  });
});

describe("streak", () => {
  const played = (...dates: string[]) => dates.reduce((p, d) => recordDaily(p, d, 1), emptyProgress());
  it("counts days in a row up to today, or up to yesterday when today is not played yet", () => {
    expect(streak(played("2026-12-02", "2026-12-03", "2026-12-04"), "2026-12-04")).toBe(3);
    expect(streak(played("2026-12-02", "2026-12-03"), "2026-12-04")).toBe(2);
    expect(progressLine(played("2026-12-02", "2026-12-03"), "2026-12-04")).toBe("2-day streak, play today to keep it.");
  });
  it("a missed day ends the streak", () => {
    expect(streak(played("2026-12-01", "2026-12-03", "2026-12-04"), "2026-12-04")).toBe(2);
    expect(streak(played("2026-12-01", "2026-12-02"), "2026-12-04")).toBe(0);
  });
  it("runs across a month and a year end", () => {
    expect(streak(played("2026-11-30", "2026-12-01"), "2026-12-01")).toBe(2);
    expect(streak(played("2026-12-31", "2027-01-01"), "2027-01-01")).toBe(2);
  });
  it("the card line shows the largest count of today and the streak", () => {
    let p = recordDaily(emptyProgress(), "2026-12-04", 2);
    p = recordDaily(p, "2026-12-04", 1); // a later pick with a clash: the card keeps 2
    expect(progressLine(p, "2026-12-04")).toBe("Your best today: 2. 1-day streak.");
    for (const w of ["beat", "win", "winner", "won", "lose", "lost", "better", "worse"]) expect(progressLine(p, "2026-12-04")!.toLowerCase().split(/[^a-z]+/)).not.toContain(w);
    expect(progressLine(recordDaily(emptyProgress(), "2026-12-04", 0), "2026-12-04")).toBe("1-day streak.");
    expect(progressLine(emptyProgress(), "2026-12-04")).toBeNull();
  });
});
