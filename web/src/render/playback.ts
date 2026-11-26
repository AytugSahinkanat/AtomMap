// Playback reducer: turns Engine run events into map state. Pure, no DOM.
// Also holds the rAF playback loop (createPlayer). Per-point arrays match
// the codes and indices used by render/dynamic-layer.ts (index = position in `ids`).

import type { Status as LayerStatus } from './dynamic-layer';
import {
  flashStrength,
  foldShots,
  newFlashes,
  shotsPerSecond,
  stepFlashes,
  sweepMs,
  type AtomsView,
  type Flashes,
} from './shot-replay';

/** Same values as `Status` in dynamic-layer.ts (checked by the type). */
export const PointStatus = {
  Undecided: 0,
  Picked: 1,
  RulePicked: 2,
  Removed: 3,
  FiveGhzOnly: 4,
} as const satisfies typeof LayerStatus;

/** Engine run event. Superset of client.ts RunEvent (adds `frequencies` and `removed`). */
export interface PlaybackEvent {
  type: 'run';
  kind: 'simulate' | 'pick' | 'frequencies' | 'shots' | string;
  competitor: string;
  round: number;
  step: number;
  /** `shots` events only: per shot, the indexes into `tile` of the Points kept after repair. */
  kept?: number[][];
  tile?: string[] | null;
  picked?: string[];
  source?: string;
  removed?: string[];
  frequencies?: Record<string, number>;
}

export interface PlaybackState {
  /** Point ids, in the order used by every per-point array. */
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  /** Glow target 0..1 per point (glow level = frequency). */
  readonly glowTarget: Float32Array;
  readonly status: Uint8Array;
  /** Channel per point (1, 6, 11), 0 while not picked. */
  readonly channel: Uint8Array;
  /** 1 where the pick was classical but not a rule (annealing fallback, coin flip), else 0. Only read for outlined points. */
  readonly classical: Uint8Array;
  /** Point indices of the stitch outline, or null. */
  readonly tile: readonly number[] | null;
  /** Round of the last Hybrid event, or null before the first. */
  readonly round: number | null;
  /** Point indices of the Group on the atoms now (from `simulate` until the next pick), or null. */
  readonly group: readonly number[] | null;
  /** The real repaired shots of that Group (its `shots` event), or null before they arrive. */
  readonly shots: { readonly group: readonly number[]; readonly kept: readonly (readonly number[])[] } | null;
  /** The shots of the last Group that had them, kept after its pick and across Rounds (the histogram's end state). */
  readonly lastShots: { readonly group: readonly number[]; readonly kept: readonly (readonly number[])[] } | null;
  /** Plain-words status line. */
  readonly statusLine: string;
}

export const COMPETITOR_LABELS: Readonly<Record<string, string>> = {
  Atoms_Alone: 'Atoms alone',
  Hybrid: 'Atoms + classical rules',
  Annealing_Rules: 'Annealing + rules',
  Coin_Flip_Rules: 'Coin flip + rules',
};

/** Status while the non-Hybrid competitors compute for the scoreboard. */
export const OTHERS_STATUS = 'Computing the other 3 methods for the scoreboard';

export function competitorLabel(name: string): string {
  return COMPETITOR_LABELS[name] ?? name;
}

export function initialState(ids: readonly string[]): PlaybackState {
  const n = ids.length;
  return {
    ids,
    index: new Map(ids.map((id, i) => [id, i] as const)),
    glowTarget: new Float32Array(n),
    status: new Uint8Array(n),
    channel: new Uint8Array(n),
    classical: new Uint8Array(n),
    tile: null,
    round: null,
    group: null,
    shots: null,
    lastShots: null,
    statusLine: '',
  };
}

function toIdx(s: PlaybackState, ids: readonly string[] | null | undefined): number[] {
  const out: number[] = [];
  for (const id of ids ?? []) {
    const i = s.index.get(id);
    if (i !== undefined) out.push(i);
  }
  return out;
}

/** Apply one event. Returns a new state; the input is not changed. */
export function apply(state: PlaybackState, ev: PlaybackEvent): PlaybackState {
  if (ev.competitor !== 'Hybrid') {
    return { ...state, statusLine: OTHERS_STATUS };
  }

  let glowTarget = state.glowTarget;
  let status = state.status;
  let channel = state.channel;
  let classical = state.classical;
  let tile = state.tile;
  let statusLine = state.statusLine;
  let group = state.group;
  let shots = state.shots;
  let lastShots = state.lastShots;

  // A new round starts clean: removed points come back, glow and outline go.
  if (state.round !== null && ev.round !== state.round) {
    status = status.slice();
    glowTarget = new Float32Array(glowTarget.length);
    for (let i = 0; i < status.length; i++) {
      if (status[i] === PointStatus.Removed) status[i] = PointStatus.Undecided;
    }
    tile = null;
    group = null;
    shots = null;
  }

  if (ev.kind === 'frequencies') {
    glowTarget = glowTarget.slice();
    for (const [id, f] of Object.entries(ev.frequencies ?? {})) {
      const i = state.index.get(id);
      if (i === undefined || status[i] !== PointStatus.Undecided) continue;
      glowTarget[i] = Math.min(1, Math.max(0, f));
    }
    tile = null; // the stitch outline ends at the next frequencies event
    // The `shots` event right after it replaces this line. A Group without one (Requirement 7.9)
    // shows its frequencies at once and keeps this line.
    statusLine = `Round ${ev.round}: results reused from an earlier step`;
  } else if (ev.kind === 'shots') {
    // The shots the frequencies above were computed from: the map replays them (Requirement 7.3).
    const g = toIdx(state, ev.tile);
    shots = { group: g, kept: (ev.kept ?? []).map((k) => k.slice()) };
    lastShots = shots;
    group = g;
    statusLine = `The atoms ran ${shots.kept.length} shots on ${g.length} points`;
  } else if (ev.kind === 'pick') {
    group = null; // the step ends: the atoms of this step are done
    shots = null;
    if (status === state.status) status = status.slice();
    if (glowTarget === state.glowTarget) glowTarget = glowTarget.slice();
    channel = channel.slice();
    classical = classical.slice();
    // Filled only when the atoms picked it. Every classical pick (rule, annealing fallback, coin flip) is outlined.
    const rule = ev.source !== undefined && ev.source !== 'atoms';
    for (const i of toIdx(state, ev.picked)) {
      status[i] = rule ? PointStatus.RulePicked : PointStatus.Picked;
      channel[i] = ev.round;
      classical[i] = rule && ev.source !== 'rule' ? 1 : 0;
      glowTarget[i] = 0;
    }
    for (const i of toIdx(state, ev.removed)) {
      if (status[i] === PointStatus.Picked || status[i] === PointStatus.RulePicked) continue;
      status[i] = PointStatus.Removed;
      glowTarget[i] = 0;
    }
    statusLine = `Round ${ev.round}: picked by ${ev.source ?? 'a rule'}`;
  } else if (ev.kind === 'simulate') {
    tile = toIdx(state, ev.tile);
    group = tile;
    shots = null;
    statusLine = `Atoms are working on ${tile.length} points`;
  }

  return { ...state, glowTarget, status, channel, classical, tile, group, shots, lastShots, round: ev.round, statusLine };
}

/**
 * End state of a finished run. Every point that was picked in no Round (still
 * undecided, or removed in the last Round) becomes `FiveGhzOnly`, drawn as the
 * hollow grey circle. Glow and the stitch outline go. Picks are kept. Pure: the
 * input is not changed. Used after full playback and after skip alike, so both
 * end in the same picture.
 */
export function finalizeState(state: PlaybackState): PlaybackState {
  const status = state.status.slice();
  for (let i = 0; i < status.length; i++) {
    const s = status[i];
    if (s !== PointStatus.Picked && s !== PointStatus.RulePicked) status[i] = PointStatus.FiveGhzOnly;
  }
  return {
    ...state,
    status,
    glowTarget: new Float32Array(status.length),
    tile: null,
    group: null,
    shots: null,
  };
}

// ---------------------------------------------------------------------------
// rAF playback loop (task 8.5). Reads the client buffer, applies due events with
// `apply`, and asks for at most one redraw per frame. Clock and raf are injected.

export interface PlayerDeps {
  /** Run events in arrival order (client.ts `buffer`). Read only here. */
  buffer: readonly PlaybackEvent[];
  /** State before the first event. */
  initial: PlaybackState;
  /** Events per second from the speed setting (SPEED_STEPS in settings.ts). */
  eventsPerSecond: () => number;
  /** True once the worker sent the result. */
  resultReceived: () => boolean;
  /**
   * The one dynamic redraw: sync `state` into the layer, advance tweens by
   * `dtMs`, draw. Called at most once per frame. With `instant` there are no
   * tweens: jump to the end values, then draw.
   */
  draw: (state: PlaybackState, dtMs: number, instant: boolean, atoms: AtomsView | null) => void;
  /**
   * Replay the real shots (experience spec, Requirement 7): a laser sweep after each Hybrid
   * `simulate`, then the Group's shots one by one, before the next event. Off by default.
   */
  replay?: boolean;
  /** True while a tween still moves (DynamicLayer.isAnimating). */
  isAnimating: () => boolean;
  raf: (cb: (t: number) => void) => number;
  caf: (id: number) => void;
  /** Milliseconds, same clock as the rAF timestamp. */
  now: () => number;
}

export interface Player {
  /** Start the loop if it is not running. Call when events or the result arrive. */
  wake(): void;
  /** Jump to the end of the buffer, no tweens. */
  skip(): void;
  /** New run: the buffer was cleared; go back to the initial state. */
  reset(): void;
  stop(): void;
  readonly state: PlaybackState;
  readonly cursor: number;
  readonly running: boolean;
}

export function createPlayer(deps: PlayerDeps): Player {
  let state = deps.initial;
  let cursor = 0;
  let rafId: number | null = null;
  let last = 0;
  let budget = 0; // fractional events carried between frames
  let dirty = true;
  const replay = deps.replay === true;

  // The Group on the atoms: a sweep, then a replay of its shots. Events wait meanwhile.
  type Phase =
    | { kind: 'sweep'; group: readonly number[]; t: number; dur: number }
    | { kind: 'replay'; group: readonly number[]; kept: readonly (readonly number[])[]; shown: number; t: number };
  let phase: Phase | null = null;
  let flashes: Flashes | null = null;
  /**
   * Skip was pressed: from then on every event is applied as soon as it arrives (in `wake`), with
   * no pacing, sweep, replay or flash, and the loop does not run. Cleared by `reset`.
   */
  let skipped = false;

  /** Apply everything in the buffer and draw the end state at once, no tweens. */
  const flush = (): void => {
    if (cursor > deps.buffer.length) cursor = 0;
    applyRange(deps.buffer.length);
    budget = 0;
    dirty = false;
    phase = null;
    flashes = null;
    deps.draw(state, 0, true, settledView(state));
  };

  const applyRange = (to: number): void => {
    const end = Math.min(to, deps.buffer.length);
    for (; cursor < end; cursor++) state = apply(state, deps.buffer[cursor]);
    dirty = true;
  };

  const isHybrid = (ev: PlaybackEvent | undefined, kind: string): boolean =>
    ev !== undefined && ev.competitor === 'Hybrid' && ev.kind === kind;

  /**
   * Apply the next paced event. A Hybrid `frequencies` event is applied together with the
   * `shots` event right after it, so the glow starts from the replay and not from the end value.
   * Returns false when it has to wait for that `shots` event to arrive.
   */
  const applyNext = (): boolean => {
    const ev = deps.buffer[cursor];
    if (replay && isHybrid(ev, 'frequencies')) {
      const next = deps.buffer[cursor + 1];
      if (next === undefined && !deps.resultReceived()) return false;
      if (isHybrid(next, 'shots')) {
        applyRange(cursor + 2);
        startReplay();
        return true;
      }
    }
    applyRange(cursor + 1);
    if (replay && isHybrid(ev, 'simulate') && state.group) {
      phase = { kind: 'sweep', group: state.group, t: 0, dur: sweepMs(deps.eventsPerSecond()) };
    } else if (replay && isHybrid(ev, 'shots')) {
      startReplay();
    }
    return true;
  };

  const startReplay = (): void => {
    const s = state.shots;
    if (!s || s.kept.length === 0) {
      phase = null;
      return;
    }
    phase = { kind: 'replay', group: s.group, kept: s.kept, shown: 0, t: 0 };
    flashes = newFlashes(s.group.length);
  };

  const advance = (dt: number): void => {
    if (!phase) return;
    phase.t += dt;
    if (phase.kind === 'sweep') {
      if (phase.t >= phase.dur) phase = null;
    } else {
      const before = Math.floor(phase.shown);
      phase.shown = Math.min(phase.kept.length, phase.shown + (dt / 1000) * shotsPerSecond(deps.eventsPerSecond()));
      const after = Math.floor(phase.shown);
      if (flashes) stepFlashes(flashes, phase.kept, before, after, phase.t);
      if (after >= phase.kept.length && (!flashes || flashStrength(flashes, phase.t).every((x) => x === 0))) phase = null;
    }
    dirty = true;
  };

  /** What the map shows of the Group on the atoms now. All of it from the events. */
  const atomsView = (): AtomsView | null => {
    if (phase?.kind === 'sweep') {
      const n = phase.group.length;
      const zero = new Array<number>(n).fill(0);
      return { group: phase.group, glow: zero, counts: zero, shown: 0, total: 0, flash: zero, sweep: Math.min(1, phase.t / phase.dur) };
    }
    if (phase?.kind === 'replay') {
      const n = phase.group.length;
      const shown = Math.floor(phase.shown);
      const counts = foldShots(n, phase.kept, shown);
      return {
        group: phase.group,
        glow: counts.map((c) => (shown === 0 ? 0 : c / shown)),
        counts,
        shown,
        total: phase.kept.length,
        flash: flashes ? flashStrength(flashes, phase.t) : new Array<number>(n).fill(0),
        sweep: null,
      };
    }
    return settledView(state);
  };

  const frame = (t: number): void => {
    rafId = null;
    const dt = Math.max(0, t - last);
    last = t;

    // The buffer is cleared by a new run; do not read past it.
    if (cursor > deps.buffer.length) cursor = 0;

    // Other competitors' events are applied at once and never use pacing budget.
    // Without the replay, `shots` events are free too (nothing draws them). With it, a Hybrid
    // `shots` event goes with its `frequencies` event and starts the replay.
    const free = (ev: PlaybackEvent): boolean => ev.competitor !== 'Hybrid' || (!replay && ev.kind === 'shots');
    const drainOthers = (): void => {
      let to = cursor;
      while (to < deps.buffer.length && free(deps.buffer[to])) to++;
      if (to > cursor) applyRange(to);
    };
    drainOthers();
    advance(dt);
    const pending = deps.buffer.length - cursor;
    if (phase) {
      budget = 0; // the atoms are on: the next event waits for them
    } else if (pending > 0) {
      budget += (dt / 1000) * Math.max(0, deps.eventsPerSecond());
      let due = Math.floor(budget);
      budget -= due;
      // Pace Hybrid events only; skip over any non-Hybrid event for free.
      while (due > 0 && cursor < deps.buffer.length && !phase) {
        if (!applyNext()) break;
        due--;
        drainOthers();
      }
      budget += due; // unused whole events stay in the budget
      if (cursor >= deps.buffer.length) budget = 0;
    } else {
      budget = 0;
    }

    const animating = deps.isAnimating();
    if (dirty || animating || phase) {
      dirty = false;
      deps.draw(state, dt, false, atomsView());
    }

    if (
      cursor >= deps.buffer.length &&
      phase === null &&
      !deps.isAnimating() &&
      deps.resultReceived()
    ) {
      return; // drained, settled, result in: stop
    }
    rafId = deps.raf(frame);
  };

  return {
    wake() {
      if (skipped) {
        // After skip, events that arrive later are applied at once (no sweep, replay or flashes).
        if (cursor !== deps.buffer.length) flush();
        return;
      }
      if (rafId !== null) return;
      last = deps.now();
      rafId = deps.raf(frame);
    },
    skip() {
      if (rafId !== null) {
        deps.caf(rafId);
        rafId = null;
      }
      skipped = true;
      flush();
    },
    reset() {
      skipped = false;
      state = deps.initial;
      cursor = 0;
      budget = 0;
      dirty = true;
      phase = null;
      flashes = null;
    },
    stop() {
      if (rafId !== null) deps.caf(rafId);
      rafId = null;
    },
    get state() {
      return state;
    },
    get cursor() {
      return cursor;
    },
    get running() {
      return rafId !== null;
    },
  };
}

/**
 * The Group on the atoms when no sweep or replay runs: its atoms with the glow of all its
 * shots (the frequencies), or with no glow while its shots have not come. Null with no Group.
 */
export function settledView(state: PlaybackState): AtomsView | null {
  const g = state.group;
  if (!g || g.length === 0) return null;
  const n = g.length;
  const s = state.shots;
  if (s && s.group.length === n && s.group.every((v, i) => v === g[i])) {
    const counts = foldShots(n, s.kept, s.kept.length);
    const total = s.kept.length;
    return { group: g, counts, glow: counts.map((c) => (total === 0 ? 0 : c / total)), shown: total, total, flash: new Array<number>(n).fill(0), sweep: null };
  }
  const zero = new Array<number>(n).fill(0);
  return { group: g, counts: zero, glow: zero, shown: 0, total: 0, flash: zero, sweep: null };
}

/**
 * The last Group that had shots, with all of them counted: what the Shot_Histogram shows after
 * that Group's replay ended. A full replay and a skip both end here. Null before the first shots.
 */
export function lastShotsView(state: PlaybackState): AtomsView | null {
  const s = state.lastShots;
  if (!s || s.group.length === 0) return null;
  const n = s.group.length;
  const total = s.kept.length;
  const counts = foldShots(n, s.kept, total);
  return { group: s.group, counts, glow: counts.map((c) => (total === 0 ? 0 : c / total)), shown: total, total, flash: new Array<number>(n).fill(0), sweep: null };
}

/** Real clock and raf for the browser. */
export function browserTiming(): Pick<PlayerDeps, 'raf' | 'caf' | 'now'> {
  return {
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
  };
}
