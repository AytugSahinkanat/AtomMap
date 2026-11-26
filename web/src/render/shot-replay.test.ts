// Shot replay (experience spec, Requirements 7.3, 7.4, 7.7, 7.9 and 22.6).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FLASH_GAP_MS, MAX_SWEEP_MS, foldGlow, foldShots, newFlashes, stepFlashes, sweepMs } from './shot-replay';
import { createPlayer, initialState, lastShotsView, settledView, type PlaybackEvent, type PlaybackState } from './playback';
import type { AtomsView } from './shot-replay';

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** The Engine's frequency rule (simulator.part_shots): the share of kept lists that contain the index. */
function engineFrequencies(tile: string[], kept: number[][]): Record<string, number> {
  const out: Record<string, number> = {};
  tile.forEach((id, j) => {
    out[id] = kept.length === 0 ? 0 : kept.filter((k) => k.includes(j)).length / kept.length;
  });
  return out;
}

const run = (e: Partial<PlaybackEvent>): PlaybackEvent => ({ type: 'run', kind: 'pick', competitor: 'Hybrid', round: 1, step: 0, ...e });

/** simulate, frequencies, shots and the pick of one step, as the Engine sends them. */
function step(tile: string[], kept: number[][], pick: string, stepNo = 0): PlaybackEvent[] {
  return [
    run({ kind: 'simulate', tile, step: stepNo }),
    run({ kind: 'frequencies', tile, step: stepNo, frequencies: engineFrequencies(tile, kept) }),
    run({ kind: 'shots', tile, step: stepNo, kept }),
    run({ kind: 'pick', picked: [pick], source: 'atoms', step: stepNo }),
  ];
}

const keptArb = (n: number) =>
  fc.array(fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { maxLength: n }).map((k) => k.sort((x, y) => x - y)), {
    minLength: 1,
    maxLength: 60,
  });

describe('foldShots and foldGlow', () => {
  it('after every shot, the glow equals the frequencies event of the Group', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }).chain((n) => fc.tuple(fc.constant(n), keptArb(n))), ([n, kept]) => {
        const tile = IDS.slice(0, n);
        const freq = engineFrequencies(tile, kept);
        const glow = foldGlow(n, kept, kept.length);
        tile.forEach((id, j) => expect(glow[j]).toBeCloseTo(freq[id], 12));
      }),
    );
  });
  it('counts only the shots replayed so far', () => {
    const kept = [[0], [0, 2], [1]];
    expect(foldShots(3, kept, 0)).toEqual([0, 0, 0]);
    expect(foldShots(3, kept, 2)).toEqual([2, 0, 1]);
    expect(foldGlow(3, kept, 2)).toEqual([1, 0, 0.5]);
  });
});

describe('flashes', () => {
  it('an atom starts at most one flash per FLASH_GAP_MS, and only on a shot that kept it', () => {
    fc.assert(
      fc.property(keptArb(4), fc.integer({ min: 1, max: 200 }), (kept, perSecond) => {
        const f = newFlashes(4);
        const starts: number[][] = [[], [], [], []];
        for (let s = 0; s < kept.length; s++) {
          const t = (s * 1000) / perSecond;
          for (const j of stepFlashes(f, kept, s, s + 1, t)) {
            expect(kept[s]).toContain(j);
            starts[j].push(t);
          }
        }
        for (const list of starts) for (let i = 1; i < list.length; i++) expect(list[i] - list[i - 1]).toBeGreaterThanOrEqual(FLASH_GAP_MS);
      }),
    );
  });
  it('the sweep never takes longer than 600 ms', () => {
    for (const eps of [1, 2, 5, 10, 25, 50, 100]) expect(sweepMs(eps)).toBeLessThanOrEqual(MAX_SWEEP_MS);
  });
});

describe('player with replay', () => {
  const mk = (events: PlaybackEvent[], eps = 25) => {
    let t = 0;
    let cb: ((t: number) => void) | null = null;
    const views: (AtomsView | null)[] = [];
    let last: { state: PlaybackState; instant: boolean } | null = null;
    const player = createPlayer({
      buffer: events,
      initial: initialState(IDS),
      eventsPerSecond: () => eps,
      resultReceived: () => true,
      draw: (state, _dt, instant, atoms) => {
        views.push(atoms);
        last = { state, instant };
      },
      replay: true,
      isAnimating: () => false,
      raf: (f) => ((cb = f), 1),
      caf: () => { cb = null; },
      now: () => t,
    });
    const frame = (ms: number) => { t += ms; const f = cb; cb = null; f?.(t); };
    const runOut = () => { for (let i = 0; i < 10000 && player.running; i++) frame(16); };
    return { player, views, frame, runOut, last: () => last };
  };

  const kept = [[0, 2], [1], [0, 2], [0], [2], [0, 2], [1], [0]];
  const events = [...step(['a', 'b', 'c'], kept, 'a', 0), ...step(['d', 'e'], [[0], [1], [0]], 'd', 1)];

  it('replays every shot before the pick, and the last replayed view equals the frequencies', () => {
    const p = mk(events);
    p.player.wake();
    p.runOut();
    const replayed = p.views.filter((v): v is AtomsView => v !== null && v.total === kept.length && v.group.length === 3);
    expect(replayed.length).toBeGreaterThan(0);
    const end = replayed[replayed.length - 1];
    expect(end.shown).toBe(kept.length);
    const freq = engineFrequencies(['a', 'b', 'c'], kept);
    ['a', 'b', 'c'].forEach((id, j) => expect(end.glow[j]).toBeCloseTo(freq[id], 12));
    // The glow grew shot by shot: some view showed fewer shots than all of them.
    expect(replayed.some((v) => v.shown < kept.length)).toBe(true);
    // A sweep came first.
    expect(p.views.some((v) => v !== null && v.sweep !== null)).toBe(true);
  });

  it('skip ends in the same state as a full replay', () => {
    const full = mk(events);
    full.player.wake();
    full.runOut();
    const skipped = mk(events);
    skipped.player.wake();
    skipped.frame(16);
    skipped.player.skip();
    const a = full.last()!.state;
    const b = skipped.last()!.state;
    expect(skipped.last()!.instant).toBe(true);
    expect(Array.from(b.status)).toEqual(Array.from(a.status));
    expect(Array.from(b.channel)).toEqual(Array.from(a.channel));
    expect(Array.from(b.glowTarget)).toEqual(Array.from(a.glowTarget));
    expect(b.group).toEqual(a.group);
  });

  it('skip before the run ends: later events are applied at once, with no sweep, replay or flash', () => {
    // The worker is still running: the buffer grows after skip, and the result comes last.
    const buffer: PlaybackEvent[] = [];
    let result = false;
    let t = 0;
    let cb: ((t: number) => void) | null = null;
    const draws: { instant: boolean; atoms: AtomsView | null; cursor: number }[] = [];
    const player = createPlayer({
      buffer,
      initial: initialState(IDS),
      eventsPerSecond: () => 25,
      resultReceived: () => result,
      draw: (_s, _dt, instant, atoms) => draws.push({ instant, atoms, cursor: player.cursor }),
      replay: true,
      isAnimating: () => false,
      raf: (f) => ((cb = f), 1),
      caf: () => { cb = null; },
      now: () => t,
    });
    const frame = (ms: number) => { t += ms; const f = cb; cb = null; f?.(t); };
    buffer.push(...events.slice(0, 2)); // simulate and frequencies of step 0
    player.wake();
    frame(16);
    player.skip();
    expect(player.running).toBe(false); // no loop after skip: nothing is paced any more
    const afterSkip = draws.length;
    // The rest arrives in two batches, each followed by a wake (as main.ts does on run events).
    buffer.push(...events.slice(2, 5));
    player.wake();
    expect(player.cursor).toBe(5); // applied at once, no frame needed
    buffer.push(...events.slice(5));
    result = true;
    player.wake();
    expect(player.cursor).toBe(events.length);
    expect(player.running).toBe(false);
    for (let i = 0; i < 100; i++) frame(16); // no frame is pending; nothing more is drawn
    const later = draws.slice(afterSkip);
    expect(later.length).toBe(2);
    for (const d of later) {
      expect(d.instant).toBe(true);
      expect(d.atoms === null || (d.atoms.sweep === null && d.atoms.flash.every((x) => x === 0))).toBe(true);
    }
    // Same end state as watching the whole replay, histogram included.
    const full = mk(events);
    full.player.wake();
    full.runOut();
    const a = full.player.state;
    const b = player.state;
    expect(Array.from(b.status)).toEqual(Array.from(a.status));
    expect(Array.from(b.channel)).toEqual(Array.from(a.channel));
    expect(Array.from(b.glowTarget)).toEqual(Array.from(a.glowTarget));
    expect(lastShotsView(b)).toEqual(lastShotsView(a));
    expect(lastShotsView(b)?.group).toEqual([3, 4]);
    expect(lastShotsView(b)?.counts).toEqual([2, 1]);
  });

  it('a Group without a shots event takes its frequencies at once with the reused line', () => {
    const tile = ['a', 'b'];
    const evs = [
      run({ kind: 'simulate', tile }),
      run({ kind: 'frequencies', tile, frequencies: { a: 0.75, b: 0.25 } }),
      run({ kind: 'pick', picked: ['a'], source: 'atoms' }),
    ];
    const p = mk(evs);
    p.player.wake();
    let reusedSeen = false;
    for (let i = 0; i < 1000 && p.player.running; i++) {
      p.frame(16);
      const st = p.player.state;
      if (st.statusLine.includes('results reused from an earlier step')) {
        reusedSeen = true;
        expect(st.glowTarget[0]).toBeCloseTo(0.75, 6);
        expect(settledView(st)?.total).toBe(0); // no replay: nothing was made up
      }
    }
    expect(reusedSeen).toBe(true);
  });
});
