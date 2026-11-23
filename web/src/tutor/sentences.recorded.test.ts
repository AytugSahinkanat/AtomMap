// Recorded run checks for the sentences (tutor spec, task 4.6).
// Constants come from the task text, fixed before running (honesty rule 8).
// Do not change them to fit a recording. A missing file skips its tests.

import { describe, expect, it } from "vitest";
import { buildStraightEdges } from "../edges/straight";
import { deriveFacts, type Facts, type TutorEvent } from "./facts";
import { buildIdle, buildSteps, type Step } from "./sentences";
import { RECORDED_NAMES, loadRecorded, recordedTitle, type RecordedName } from "./recorded";

const BANNED = ["faster", "speed", "wins", "winner", "beats", "best", "the atoms chose", "the atoms decided"];
const RANKING = ["more than", "fewer", "less than", "higher", "lower", "ahead", "behind", "first place", "better", "worse", "most", "least", "top"];

function factsOf(name: RecordedName): Facts {
  const run = loadRecorded(name)!;
  const r = run.request.graph?.r ?? 0;
  return deriveFacts({
    mode: run.request.mode,
    seed: run.request.seed,
    ids: run.request.points.map((p) => p.id),
    edges: buildStraightEdges(run.request.points, r),
    events: run.events as TutorEvent[],
    result: run.result as any,
  });
}

const stepsOf = (name: RecordedName): Step[] => buildSteps(factsOf(name), "Hybrid");
const keysOf = (steps: Step[]) => steps.map((s) => s.key);
const textOf = (steps: Step[]) => steps.flatMap((s) => s.sentences).join(" ");
const has = (name: RecordedName) => loadRecorded(name) !== null;

describe.each(RECORDED_NAMES)("Sentences of %s", (name) => {
  const it_ = (title: string, fn: () => void) => it.skipIf(!has(name))(recordedTitle(name, title), fn);

  it_("has no banned word in any sentence", () => {
    for (const step of stepsOf(name)) {
      for (const s of step.sentences) {
        const lower = s.toLowerCase();
        expect(BANNED.filter((w) => lower.includes(w)), s).toEqual([]);
      }
    }
  });

  it_("has at most 260 characters per Step", () => {
    for (const step of stepsOf(name)) {
      const len = step.sentences.join(" ").length;
      expect(len, `${step.key}: ${step.sentences.join(" ")}`).toBeLessThanOrEqual(260);
    }
  });
});

describe("Sentences of hero_seed1 (Steps)", () => {
  const it_ = (title: string, fn: () => void) =>
    it.skipIf(!has("hero_seed1"))(recordedTitle("hero_seed1", title), fn);

  it_("shows Steps 1 to 8", () => {
    expect(keysOf(stepsOf("hero_seed1"))).toEqual([
      "rules-first",
      "groups",
      "group",
      "pick",
      "after",
      "round-1",
      "round-2",
      "round-3",
      "result",
      "compare",
    ]);
  });

  it_("Step 8 only lists numbers and has no ranking wording", () => {
    const step = stepsOf("hero_seed1").find((s) => s.key === "compare")!;
    expect(step.sentences).toHaveLength(6);
    expect(step.sentences[0]).toBe("Picks of the four plans in this run:");
    expect(step.sentences[5]).toBe("One run proves nothing.");
    for (const s of step.sentences.slice(1, 5)) expect(s).toMatch(/^[A-Za-z0-9+ ()\-]+: \d+\.$/);
    const lower = step.sentences.join(" ").toLowerCase();
    expect(RANKING.filter((w) => lower.includes(w))).toEqual([]);
    expect(lower).not.toContain("tie");
    for (const total of [25, 31, 35, 33]) expect(step.sentences.join(" ")).toContain(`: ${total}.`);
  });
});

describe.each(["hero_seed1", "sparse_seed1"] as const)("Steps 4 and 5 of %s", (name) => {
  it.skipIf(!has(name))(recordedTitle(name, "Step 4 and Step 5 exist (atomPick found)"), () => {
    const facts = factsOf(name);
    expect(facts.atomPick).toBeDefined();
    const keys = keysOf(buildSteps(facts, "Hybrid"));
    expect(keys).toContain("pick");
    expect(keys).toContain("after");
  });
});

describe("Sentences of sparse_seed1 (Quantum_Share)", () => {
  it.skipIf(!has("sparse_seed1"))(recordedTitle("sparse_seed1", "shows its Quantum_Share"), () => {
    // 2 of 51 picks from the atoms (task 3.3 constants).
    const result = stepsOf("sparse_seed1").find((s) => s.key === "result")!;
    const text = result.sentences.join(" ");
    expect(text).toContain("Quantum share: 3.9%");
    expect(text).toContain("2 of 51 picks came from the atoms");
  });

  it.skipIf(!has("sparse_seed1"))(recordedTitle("sparse_seed1", "Step 8 shows the tie"), () => {
    const step = stepsOf("sparse_seed1").find((s) => s.key === "compare")!;
    expect(step.sentences.join(" ")).toContain("(tie)");
  });
});

describe.each(["rules_only", "place_rules_only"] as const)("Sentences of %s (atoms not needed)", (name) => {
  const it_ = (title: string, fn: () => void) => it.skipIf(!has(name))(recordedTitle(name, title), fn);

  it_("shows no Steps 2 to 5", () => {
    const keys = keysOf(stepsOf(name));
    for (const k of ["groups", "group", "pick", "after"]) expect(keys).not.toContain(k);
  });

  it_("says the atoms weren't needed and shows 0%", () => {
    const text = textOf(stepsOf(name));
    expect(text).toContain("The atoms weren't needed on this map.");
    expect(text).toContain("Quantum share: 0%");
  });

  it_("says no group went to the atoms instead of 0 splits", () => {
    const text = textOf(stepsOf(name));
    expect(text).toContain("No group went to the atoms, so nothing was split or skipped.");
    expect(text).not.toContain("split in two");
  });
});

describe("Wording of recorded runs", () => {
  it.skipIf(!has("hero_seed1"))(recordedTitle("hero_seed1", "uses the new wording"), () => {
    const steps = stepsOf("hero_seed1");
    const by = (k: string) => steps.find((s) => s.key === k)!.sentences.join(" ");
    expect(by("rules-first")).toContain("so picking it is always safe");
    expect(by("groups")).toContain(
      "The other 65 points were too tangled for the rules. On channel 1 they were cut into 15 small groups of 4 to 8 points, and each group ran on the atoms 100 times. This is a simulation.",
    );
    expect(by("group").startsWith("Close atoms can't light up together")).toBe(true);
    expect(by("pick")).toContain("ranks the 65 points left by how often they lit up, keeps the top 26");
    expect(by("pick")).toContain("ap60, rank 5, lit up in 34 of 100 tries.");
    expect(by("after")).toBe("That pick opened no new safe picks for the rules.");
    expect(by("round-1")).toContain("70 points to choose from, 11 picks.");
    expect(by("round-1")).not.toContain("classically");
    expect(by("round-2")).toContain("1 classically, without atoms.");
    expect(by("result")).toContain("groups were split in two because the atoms couldn't be placed exactly like the map");
    expect(by("result")).not.toContain("Result label");
    expect(textOf(steps)).not.toMatch(/\bPoints?\b/);
  });

  it.skipIf(!has("place_rules_only"))(recordedTitle("place_rules_only", "says the rules made all picks"), () => {
    const text = textOf(stepsOf("place_rules_only"));
    expect(text).toMatch(/The rules made all \d+ picks on their own\./);
    expect(text).not.toContain("Before any atoms ran");
  });
});

describe("buildIdle", () => {
  it("has the hall and the place text", () => {
    expect(buildIdle("channel_plan")).toEqual([
      "Each dot is a wifi access point. A line joins two that are too close to share a channel.",
      "Press Run to see how the atoms and the rules build the plan, step by step.",
    ]);
    expect(buildIdle("place")[0]).toBe("Each dot is a cafe. A line joins two that are too close to both be picked.");
  });
});