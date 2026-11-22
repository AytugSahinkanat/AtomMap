import { describe, expect, it } from "vitest";
import { focusInside } from "./focus";

describe("focusInside", () => {
  const inner = {};
  const outer = { contains: (x: unknown) => x === inner };
  it("is true only for focus inside the container", () => {
    expect(focusInside(outer, inner)).toBe(true);
    expect(focusInside(outer, {})).toBe(false);
    expect(focusInside(outer, null)).toBe(false);
    expect(focusInside(null, inner)).toBe(false);
  });
});
