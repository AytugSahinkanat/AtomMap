import { describe, expect, it } from 'vitest';
import { buildCards, type PartialResults } from '../scoreboard-model';
import { describeCard, type CardView } from './scoreboard';
import { legendEntries } from './legend';
import { DEFAULT_SPEED, SPEED_STEPS } from '../settings';
import { finalizeState, initialState, PointStatus, apply, type PlaybackEvent } from '../render/playback';
import { colourForChannel, shapeForChannel } from '../render/sprites';
import { nextSeed, parseSeed } from '../seed';

const BANNED = /faster|speed|wins|winner|beats|crown/i;

function ready(total: number, share: number, extra: Record<string, unknown> = {}) {
  return {
    label: 'simulation',
    rounds: [
      { channel: 1, picks: ['a'] },
      { channel: 6, picks: [] },
    ],
    stats: {
      total_picks: total,
      quantum_picks: Math.round(total * share),
      quantum_share: share,
      splits: 0,
      skipped_tiles: 0,
      mismatches: 0,
      atoms_not_needed: false,
      gaps: [],
      ...extra,
    },
  };
}

function views(partial: PartialResults, mode: 'channel_plan' | 'place' = 'channel_plan'): CardView[] {
  return buildCards(partial).map((c) => describeCard(c, mode));
}

describe('describeCard', () => {
  it('pending cards say Computing and show no digits', () => {
    for (const v of views({})) {
      expect(v.state).toBe('pending');
      expect(v.message).toBe('Computing\u2026');
      expect(v.rows).toHaveLength(0);
      expect(v.share).toBeNull();
    }
  });

  it('fills in card by card; the others stay pending', () => {
    const v = views({ Hybrid: ready(10, 0.2) });
    expect(v.map((c) => c.state)).toEqual(['pending', 'ready', 'pending', 'pending']);
  });

  it('a ready card shows big total, per-round line, share, label, and details at 0', () => {
    const v = views({ Annealing_Rules: ready(7, 0) })[2];
    expect(v.total).toBe('7');
    expect(v.perRound).toBe('1 / 0');
    expect(v.share?.text).toBe('Quantum share: 0%');
    expect(v.resultLabel).toBe('simulation');
    const rows = Object.fromEntries(v.rows.map((r) => [r.label, r.value]));
    expect(rows['Groups split in two']).toBe('0');
    expect(rows['Groups skipped']).toBe('0');
    expect(rows['Layout mismatches']).toBe('0');
  });

  it('place mode shows one number, no slashes', () => {
    const c = ready(3, 0.5);
    c.rounds = [{ channel: 1, picks: ['a', 'b', 'c'] }];
    const v = views({ Hybrid: c }, 'place')[1];
    expect(v.perRound).toBe('3');
  });

  it('atoms note per competitor', () => {
    const v = views({
      Atoms_Alone: ready(5, 1, { atoms_not_needed: true }),
      Hybrid: ready(5, 0, { atoms_not_needed: true }),
      Annealing_Rules: ready(5, 0, { atoms_not_needed: true }),
      Coin_Flip_Rules: ready(5, 0, { atoms_not_needed: true }),
    });
    expect(v[0].notes.join()).not.toMatch(/weren't needed|doesn't use/);
    expect(v[1].notes).toContain("atoms weren't needed on this map");
    expect(v[2].notes).toContain("This method doesn't use atoms.");
    expect(v[3].notes).toContain("This method doesn't use atoms.");
    for (const i of [0, 2, 3]) expect(v[i].notes).not.toContain("atoms weren't needed on this map");
    for (const x of v) expect(x.share?.text).toBe(x.key === 'Atoms_Alone' ? 'Quantum share: 100%' : 'Quantum share: 0%');
  });
  it('only atoms alone shows uncovered points; ties are named, nothing is a winner', () => {
    const all = views({
      Atoms_Alone: ready(5, 1, { gaps: ['x', 'y'] }),
      Hybrid: ready(5, 0.2),
      Annealing_Rules: ready(4, 0),
      Coin_Flip_Rules: ready(3, 0),
    });
    expect(all[0].rows.some((r) => r.label === 'Points left uncovered' && r.value === '2')).toBe(true);
    expect(all[1].rows.some((r) => r.label === 'Points left uncovered')).toBe(false);
    expect(all[0].notes).toContain('tie');
    expect(all[1].notes).toContain('tie');
    expect(all[2].notes).not.toContain('tie');
    const text = JSON.stringify(all);
    expect(text).not.toMatch(BANNED);
  });

  it('an error entry shows words only', () => {
    const v = views({ Hybrid: { error: 'ValueError: bad 42' } })[1];
    expect(v.state).toBe('error');
    expect(v.message).not.toMatch(/\d/);
  });
});

describe('seed helpers used by the scoreboard', () => {
  it('rejects a non-integer and prefills previous + 1', () => {
    expect(parseSeed('1.5').ok).toBe(false);
    expect(parseSeed('abc')).toMatchObject({ ok: false });
    expect(nextSeed(1)).toBe(2);
  });
});

describe('legend', () => {
  it('channel plan: shapes and colours match the render layer, text names both', () => {
    const e = legendEntries('channel_plan');
    const byGlyph = Object.fromEntries(e.map((x) => [x.glyph, x]));
    expect(byGlyph.circle.colour).toBe(colourForChannel(1));
    expect(byGlyph.triangle.colour).toBe(colourForChannel(6));
    expect(byGlyph.square.colour).toBe(colourForChannel(11));
    expect(byGlyph.hollow.colour).toBe(colourForChannel(5));
    expect(shapeForChannel(1)).toBe('circle');
    expect(shapeForChannel(6)).toBe('triangle');
    expect(shapeForChannel(11)).toBe('square');
    expect(shapeForChannel(5)).toBe('hollow');
    expect(byGlyph.circle.text).toMatch(/circle.*channel 1/i);
    expect(byGlyph.triangle.text).toMatch(/triangle.*channel 6/i);
    expect(byGlyph.square.text).toMatch(/square.*channel 11/i);
    expect(byGlyph.hollow.text).toMatch(/5 GHz only/);
    expect(byGlyph.filled.text).toMatch(/atoms/);
    expect(byGlyph['outlined-lock'].text).toMatch(/classical/);
    expect(byGlyph.filled.text).toBe('Filled shape: picked by the atoms');
    expect(byGlyph.filled.text).not.toMatch(/annealing/i);
    for (const x of e) expect(x.text).toMatch(/shape|circle|triangle|square/i); // never colour alone
  });

  it('place mode has no channels', () => {
    const t = legendEntries('place').map((x) => x.text).join(' ');
    expect(t).not.toMatch(/channel/i);
    expect(t).toMatch(/not picked/);
  });
});

describe('final state styling', () => {
  const ev = (e: Partial<PlaybackEvent>): PlaybackEvent => ({
    type: 'run', kind: 'pick', competitor: 'Hybrid', round: 1, step: 0, ...e,
  });

  it('unpicked, removed and undecided points end as 5 GHz only; picks stay', () => {
    let s = initialState(['a', 'b', 'c', 'd']);
    s = apply(s, ev({ picked: ['a'], removed: ['b'] }));
    s = apply(s, ev({ round: 6, kind: 'frequencies', frequencies: { c: 0.5 } }));
    s = apply(s, ev({ round: 6, picked: ['c'], source: 'rule', removed: ['d'] }));
    const f = finalizeState(s);
    expect(Array.from(f.status)).toEqual([
      PointStatus.Picked,
      PointStatus.FiveGhzOnly, // b came back in round 6, was never picked
      PointStatus.RulePicked,
      PointStatus.FiveGhzOnly, // d removed in the last round
    ]);
    expect(Array.from(f.glowTarget).every((g) => g === 0)).toBe(true);
    expect(f.tile).toBeNull();
    expect(s.status[3]).toBe(PointStatus.Removed); // input not changed
  });

  it('a run with no events ends with every point 5 GHz only', () => {
    const f = finalizeState(initialState(['a', 'b']));
    expect(Array.from(f.status)).toEqual([PointStatus.FiveGhzOnly, PointStatus.FiveGhzOnly]);
  });
});

describe('default speed', () => {
  it('is 25 steps per second and the other steps stay', () => {
    expect(DEFAULT_SPEED).toBe(25);
    expect(SPEED_STEPS).toEqual([2, 5, 10, 25, 60]);
    expect(SPEED_STEPS).toContain(DEFAULT_SPEED);
  });
});
