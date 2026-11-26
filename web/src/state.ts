// App state. UI state only, no MIS logic.

import type { PlaceFixture } from "./data/fixtures";
import type { PlaceName } from "./settings";

export type ScreenName = "loading" | "map" | "run" | "scoreboard";

export interface AppState {
  screen: ScreenName;
  /** Loading progress, 0..100, never decreases. */
  loadPercent: number;
  loadStage: LoadStage | null;
  /** Plain-words loading error, or null. */
  loadError: string | null;
  /**
   * Simulator_Ready (experience spec, Requirement 23): the worker has loaded the engine and can run.
   * The scenes show before this; only the run button waits for it.
   */
  ready: boolean;
  /** Selected Place_Mode preset, or null before the first choice. */
  placeName: PlaceName | null;
  /** The loaded fixture of the selected place, or null. */
  placeFixture: PlaceFixture | null;
  placeLoading: boolean;
  /** Message naming the file that failed to load, or null. */
  placeError: string | null;
  /** Result of the previous run. Cleared when the place changes. */
  result: unknown | null;
}

export const state: AppState = {
  screen: "loading",
  loadPercent: 0,
  loadStage: null,
  loadError: null,
  ready: false,
  placeName: null,
  placeFixture: null,
  placeLoading: false,
  placeError: null,
  result: null,
};

type Listener = (s: Readonly<AppState>) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

/** Record a loading progress event. The percent never goes down. */
export function applyLoadProgress(p: ProgressLoadPayload): void {
  const percent = Math.max(state.loadPercent, Math.min(100, Math.max(0, p.percent)));
  update({ loadPercent: percent, loadStage: p.stage });
}

/**
 * A run finished: keep the result and move to the scoreboard screen. The
 * scoreboard (task 9.3) plugs in by reacting to `screen === "scoreboard"`.
 */
export function onFinished(result: unknown): void {
  update({ result, screen: "scoreboard" });
}
