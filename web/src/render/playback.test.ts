import { describe, expect, it } from 'vitest';
import { apply, initialState, PointStatus, type PlaybackEvent } from './playback';

const ev = (e: Partial<PlaybackEvent>): PlaybackEvent => ({
  type: 'run', kind: 'pick', competitor: 'Hybrid', round: 1, step: 0, ...e,
});

describe('playback apply', () => {
  const s0 = initialState(['a', 'b', 'c', 'd']);

  it('ignores the map for other competitors, updates the status line', () => {
    const s = apply(s0, ev({ competitor: 'Annealing_Rules', picked: ['a'] }));
    expect(s.status[0]).toBe(PointStatus.Undecided);
    expect(s.statusLine).toBe('Computing the other 3 methods for the scoreboard');
  });

  it('simulate shows the tile until frequencies; frequencies set glow', () => {
    let s = apply(s0, ev({ kind: 'simulate', tile: ['a', 'b'] }));
    expect(s.tile).toEqual([0, 1]);
    s = apply(s, ev({ kind: 'frequencies', tile: ['a', 'b'], frequencies: { a: 0.75, b: 0.25 } }));
    expect(s.tile).toBeNull();
    expect(Array.from(s.glowTarget)).toEqual([0.75, 0.25, 0, 0]);
  });

  it('pick locks, marks rule picks, fades removed, and does not mutate input', () => {
    const s = apply(s0, ev({ picked: ['a'], source: 'rule', removed: ['b'] }));
    expect(s.status[0]).toBe(PointStatus.RulePicked);
    expect(s.status[1]).toBe(PointStatus.Removed);
    expect(s.channel[0]).toBe(1);
    expect(s0.status[0]).toBe(PointStatus.Undecided);
    const t = apply(s, ev({ picked: ['c'], source: 'annealing' }));
    expect(t.status[2]).toBe(PointStatus.RulePicked); // annealing is classical: outlined
    const u = apply(t, ev({ picked: ['b'], source: 'atoms' }));
    expect(u.status[1]).toBe(PointStatus.Picked);
  });

  it('tags rule picks "rule", annealing and coin flip picks "classical", atoms picks neither', () => {
    let s = apply(s0, ev({ picked: ['a'], source: 'rule' }));
    s = apply(s, ev({ picked: ['b'], source: 'annealing' }));
    s = apply(s, ev({ picked: ['c'], source: 'coin flip' }));
    s = apply(s, ev({ picked: ['d'], source: 'atoms' }));
    expect(Array.from(s.classical)).toEqual([0, 1, 1, 0]);
    expect(s.status[2]).toBe(PointStatus.RulePicked);
    expect(s0.classical[1]).toBe(0);
  });

  it('a new round brings removed points back', () => {
    let s = apply(s0, ev({ picked: ['a'], removed: ['b'] }));
    s = apply(s, ev({ round: 6, kind: 'simulate', tile: ['b'] }));
    expect(s.status[1]).toBe(PointStatus.Undecided);
    expect(s.status[0]).toBe(PointStatus.Picked);
  });
});

import { createPlayer } from './playback';

describe('createPlayer', () => {
  const mk = (events: PlaybackEvent[], eps = 10) => {
    let t = 0;
    let cb: ((t: number) => void) | null = null;
    let result = false;
    const draws: { instant: boolean; n: number }[] = [];
    const player = createPlayer({
      buffer: events,
      initial: initialState(['a', 'b', 'c']),
      eventsPerSecond: () => eps,
      resultReceived: () => result,
      draw: (_s, _dt, instant) => draws.push({ instant, n: player.cursor }),
      isAnimating: () => false,
      raf: (f) => ((cb = f), 1),
      caf: () => { cb = null; },
      now: () => t,
    });
    const step = (ms: number) => { t += ms; const f = cb; cb = null; f?.(t); };
    return { player, draws, step, setResult: () => { result = true; } };
  };
  const evs = [
    ev({ picked: ['a'], source: 'atoms', removed: ['b'], step: 0 }),
    ev({ picked: ['c'], source: 'rule', step: 1 }),
  ];

  it('coalesces due events into one draw per frame and stops when drained with result', () => {
    const { player, draws, step, setResult } = mk(evs, 10);
    setResult();
    player.wake();
    step(1000); // 10 events due, only 2 pending
    expect(draws).toHaveLength(1);
    expect(player.cursor).toBe(2);
    expect(player.running).toBe(false);
  });

  it('keeps running until the result arrives', () => {
    const { player, step } = mk(evs, 10);
    player.wake();
    step(1000);
    expect(player.running).toBe(true);
  });

  it('skip equals full playback end state, drawn without tweens', () => {
    const a = mk(evs, 10);
    a.setResult();
    a.player.wake();
    a.step(1000);
    const b = mk(evs, 10);
    b.setResult();
    b.player.wake();
    b.player.skip();
    expect(b.draws[b.draws.length - 1].instant).toBe(true);
    expect(Array.from(b.player.state.status)).toEqual(Array.from(a.player.state.status));
    expect(Array.from(b.player.state.channel)).toEqual(Array.from(a.player.state.channel));
  });

  it('applies other competitors instantly and paces only Hybrid events', () => {
    const other = (c: string) => ev({ competitor: c, picked: ['b'], source: 'atoms' });
    const mixed = [evs[0], evs[1], other('Atoms_Alone'), other('Coin_Flip_Rules')];
    const { player, step } = mk(mixed, 1);
    player.wake();
    step(1000); // budget for one Hybrid event
    expect(player.cursor).toBe(1);
    step(1000); // second Hybrid event, then the others follow at once
    expect(player.cursor).toBe(4);
    expect(player.state.statusLine).toBe('Computing the other 3 methods for the scoreboard');
  });

  it('events that are only from other competitors drain in one frame and the loop ends', () => {
    const only = [ev({ competitor: 'Atoms_Alone' }), ev({ competitor: 'Annealing_Rules' })];
    const { player, step, setResult } = mk(only, 1);
    setResult();
    player.wake();
    step(16);
    expect(player.cursor).toBe(2);
    expect(player.running).toBe(false);
  });
});
