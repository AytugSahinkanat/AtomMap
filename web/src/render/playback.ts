// Playback reducer: turns Engine run events into map state. Pure, no DOM.
// Also holds the rAF playback loop (createPlayer). Per-point arrays match
// the codes and indices used by render/dynamic-layer.ts (index = position in `ids`).

import type { Status as LayerStatus } from './dynamic-layer';

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

  // A new round starts clean: removed points come back, glow and outline go.
  if (state.round !== null && ev.round !== state.round) {
    status = status.slice();
    glowTarget = new Float32Array(glowTarget.length);
    for (let i = 0; i < status.length; i++) {
      if (status[i] === PointStatus.Removed) status[i] = PointStatus.Undecided;
    }
    tile = null;
  }

  if (ev.kind === 'frequencies') {
    glowTarget = glowTarget.slice();
    for (const [id, f] of Object.entries(ev.frequencies ?? {})) {
      const i = state.index.get(id);
      if (i === undefined || status[i] !== PointStatus.Undecided) continue;
      glowTarget[i] = Math.min(1, Math.max(0, f));
    }
    tile = null; // the stitch outline ends at the next frequencies event
    statusLine = `Atoms are measured on round ${ev.round}`;
  } else if (ev.kind === 'pick') {
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
    statusLine = `Atoms are working on ${tile.length} points`;
  }

  return { ...state, glowTarget, status, channel, classical, tile, round: ev.round, statusLine };
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
  draw: (state: PlaybackState, dtMs: number, instant: boolean) => void;
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

  const applyRange = (to: number): void => {
    const end = Math.min(to, deps.buffer.length);
    for (; cursor < end; cursor++) state = apply(state, deps.buffer[cursor]);
    dirty = true;
  };

  const frame = (t: number): void => {
    rafId = null;
    const dt = Math.max(0, t - last);
    last = t;

    // The buffer is cleared by a new run; do not read past it.
    if (cursor > deps.buffer.length) cursor = 0;

    // Other competitors' events are applied at once and never use pacing budget.
    // So are `shots` events: the map does not draw them yet (experience spec, task 9), and
    // they must not slow down the pacing of the events it does draw.
    const free = (ev: PlaybackEvent): boolean => ev.competitor !== 'Hybrid' || ev.kind === 'shots';
    const drainOthers = (): void => {
      let to = cursor;
      while (to < deps.buffer.length && free(deps.buffer[to])) to++;
      if (to > cursor) applyRange(to);
    };
    drainOthers();
    const pending = deps.buffer.length - cursor;
    if (pending > 0) {
      budget += (dt / 1000) * Math.max(0, deps.eventsPerSecond());
      let due = Math.floor(budget);
      budget -= due;
      // Pace Hybrid events only; skip over any non-Hybrid event for free.
      while (due > 0 && cursor < deps.buffer.length) {
        applyRange(cursor + 1);
        due--;
        drainOthers();
      }
      budget += due; // unused whole events stay in the budget
      if (cursor >= deps.buffer.length) budget = 0;
    } else {
      budget = 0;
    }

    const animating = deps.isAnimating();
    if (dirty || animating) {
      dirty = false;
      deps.draw(state, dt, false);
    }

    if (
      cursor >= deps.buffer.length &&
      !deps.isAnimating() &&
      deps.resultReceived()
    ) {
      return; // drained, settled, result in: stop
    }
    rafId = deps.raf(frame);
  };

  return {
    wake() {
      if (rafId !== null) return;
      last = deps.now();
      rafId = deps.raf(frame);
    },
    skip() {
      if (rafId !== null) {
        deps.caf(rafId);
        rafId = null;
      }
      if (cursor > deps.buffer.length) cursor = 0;
      applyRange(deps.buffer.length);
      budget = 0;
      dirty = false;
      deps.draw(state, 0, true);
      // Events that arrive after skip still play; keep waiting for the result.
      if (!deps.resultReceived()) {
        last = deps.now();
        rafId = deps.raf(frame);
      }
    },
    reset() {
      state = deps.initial;
      cursor = 0;
      budget = 0;
      dirty = true;
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

/** Real clock and raf for the browser. */
export function browserTiming(): Pick<PlayerDeps, 'raf' | 'caf' | 'now'> {
  return {
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
  };
}
