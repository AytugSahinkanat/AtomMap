import { describe, expect, it } from "vitest";
import {
  ATOMS_NOT_NEEDED_TEXT,
  NO_ATOMS_TEXT,
  CARD_ORDER,
  PENDING_TEXT,
  buildCards,
  buildCardsFromResult,
  cardTexts,
  formatPercent,
  type ReadyCard,
} from "./scoreboard-model";

function comp(picksPerRound: number[], quantum: number, extra: Record<string, unknown> = {}, label = "simulation") {
  const channels = [1, 6, 11];
  const total = picksPerRound.reduce((a, b) => a + b, 0);
  return {
    label,
    rounds: picksPerRound.map((n, i) => ({
      channel: channels[i],
      picks: Array.from({ length: n }, (_, k) => `ap${i}_${k}`),
    })),
    stats: {
      total_picks: total,
      quantum_picks: quantum,
      quantum_share: total ? quantum / total : 0,
      atoms_not_needed: false,
      splits: 0,
      skipped_tiles: 0,
      mismatches: 0,
      ...extra,
    },
  };
}

const BANNED = ["faster", "speed", "wins", "winner", "beats", "crown"];

describe("buildCards", () => {
  it("returns four cards in fixed order, all pending for no data", () => {
    for (const input of [undefined, null, {}]) {
      const cards = buildCards(input);
      expect(cards.map((c) => c.key)).toEqual([...CARD_ORDER]);
      expect(cards.every((c) => c.state === "pending")).toBe(true);
      for (const c of cards) {
        if (c.state === "pending") {
          expect(c.text).toBe(PENDING_TEXT);
          expect(c.text).not.toMatch(/[0-9]/);
        }
      }
    }
  });

  it("hero numbers: 13/12/10 and 17.1% quantum share", () => {
    const [, hybrid] = buildCards({ Hybrid: comp([13, 12, 10], 6) });
    const h = hybrid as ReadyCard;
    expect(h.state).toBe("ready");
    expect(h.rounds.map((r) => [r.channel, r.picks])).toEqual([[1, 13], [6, 12], [11, 10]]);
    expect(h.total).toBe(35);
    expect(h.quantumShareText).toBe("17.1%");
    expect(h.quantumDetailText).toBe("6 of 35 picks came from the atoms");
    expect(h.resultLabel).toBe("simulation");
  });

  it("fills in card by card: only Hybrid ready, others pending", () => {
    const cards = buildCards({ Hybrid: comp([13, 12, 10], 6) });
    expect(cards.map((c) => c.state)).toEqual(["pending", "ready", "pending", "pending"]);
  });

  it("shows 0% share, zero counts and the atoms-not-needed text", () => {
    const [, h] = buildCards({ Hybrid: comp([5], 0, { atoms_not_needed: true }) });
    const c = h as ReadyCard;
    expect(c.quantumShareText).toBe("0%");
    expect(c.quantumDetailText).toBe("0 of 5 picks came from the atoms");
    expect(c.atomsNotNeededText).toBe(ATOMS_NOT_NEEDED_TEXT);
    expect([c.splits, c.skippedTiles, c.mismatches]).toEqual([0, 0, 0]);
  });

  it("atoms note per competitor: not-needed only on hybrid, never on the others", () => {
    const flagged = { atoms_not_needed: true };
    const cards = buildCards({
      Atoms_Alone: comp([4], 4, flagged),
      Hybrid: comp([4], 0, flagged),
      Annealing_Rules: comp([4], 0, flagged),
      Coin_Flip_Rules: comp([4], 0, flagged),
    }) as ReadyCard[];
    expect(cards.map((c) => c.atomsNotNeededText)).toEqual([null, ATOMS_NOT_NEEDED_TEXT, null, null]);
    expect(cards.map((c) => c.noAtomsText)).toEqual([null, null, NO_ATOMS_TEXT, NO_ATOMS_TEXT]);
    for (const c of cards) {
      expect(c.quantumShareText).toBeTruthy();
      if (c.key !== "Hybrid") expect(cardTexts(c).join(" ")).not.toContain("weren't needed");
    }
    const hy = buildCards({ Hybrid: comp([4], 2) })[1] as ReadyCard;
    expect(hy.atomsNotNeededText).toBeNull();
  });

  it("no atoms-not-needed text when the flag is false", () => {
    const [, h] = buildCards({ Hybrid: comp([5], 2) });
    expect((h as ReadyCard).atomsNotNeededText).toBeNull();
  });

  it("copies splits, skipped tiles and mismatches", () => {
    const [, h] = buildCards({ Hybrid: comp([5], 2, { splits: 3, skipped_tiles: 1, mismatches: 2 }) });
    const c = h as ReadyCard;
    expect([c.splits, c.skippedTiles, c.mismatches]).toEqual([3, 1, 2]);
  });

  it("atoms alone shows gaps (also 0); other cards have none", () => {
    const cards = buildCards({
      Atoms_Alone: comp([4], 4, { gaps: ["ap1", "ap2"] }),
      Hybrid: comp([5], 2),
    });
    const alone = cards[0] as ReadyCard;
    expect(alone.gaps).toEqual(["ap1", "ap2"]);
    expect(alone.gapsCount).toBe(2);
    expect((cards[1] as ReadyCard).gaps).toBeNull();
    const none = buildCards({ Atoms_Alone: comp([4], 4, { gaps: [] }) })[0] as ReadyCard;
    expect(none.gapsCount).toBe(0);
  });

  it("labels real hardware and defaults to simulation", () => {
    const [a, h] = buildCards({
      Atoms_Alone: comp([4], 4, {}, "real hardware"),
      Hybrid: comp([4], 1),
    }) as ReadyCard[];
    expect(a.resultLabel).toBe("real hardware");
    expect(h.resultLabel).toBe("simulation");
  });

  it("marks tie among ready cards with equal totals only", () => {
    const cards = buildCards({
      Atoms_Alone: comp([10], 10),
      Hybrid: comp([13, 12, 10], 6),
      Annealing_Rules: comp([13, 12, 10], 0),
      Coin_Flip_Rules: comp([9], 0),
    }) as ReadyCard[];
    expect(cards.map((c) => c.tieText)).toEqual([null, "tie", "tie", null]);
  });

  it("a pending card is never a tie, and one ready card alone is no tie", () => {
    const one = buildCards({ Hybrid: comp([5], 1) });
    expect((one[1] as ReadyCard).tie).toBe(false);
    const withError = buildCards({ Hybrid: comp([5], 1), Atoms_Alone: { error: "X: y" } });
    expect((withError[1] as ReadyCard).tie).toBe(false);
  });

  it("a tie appears when the second equal card arrives", () => {
    const first = buildCards({ Hybrid: comp([5], 1) });
    expect((first[1] as ReadyCard).tieText).toBeNull();
    const second = buildCards({ Hybrid: comp([5], 1), Coin_Flip_Rules: comp([5], 0) });
    expect((second[1] as ReadyCard).tieText).toBe("tie");
    expect((second[3] as ReadyCard).tieText).toBe("tie");
  });

  it("an error entry is plain words with no numbers; others keep their numbers", () => {
    const cards = buildCards({
      Hybrid: comp([5], 1),
      Annealing_Rules: { error: "ValueError: bad tile 42 at step 7" },
    });
    const err = cards[2];
    expect(err.state).toBe("error");
    if (err.state === "error") {
      expect(err.text).not.toMatch(/[0-9]/);
      expect(err.text.length).toBeGreaterThan(10);
    }
    expect(cards[1].state).toBe("ready");
  });

  it("no banned wording in any card text", () => {
    const cards = buildCardsFromResult({
      competitors: {
        Atoms_Alone: comp([4], 4, { gaps: [] }),
        Hybrid: comp([13, 12, 10], 6),
        Annealing_Rules: comp([13, 12, 10], 0, { atoms_not_needed: true }),
        Coin_Flip_Rules: { error: "RuntimeError: boom" },
      },
    });
    const text = cards.flatMap(cardTexts).join(" ").toLowerCase();
    for (const w of BANNED) expect(text).not.toContain(w);
  });
});

describe("formatPercent", () => {
  it("formats", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(6 / 35)).toBe("17.1%");
    expect(formatPercent(0.5)).toBe("50%");
  });
});
