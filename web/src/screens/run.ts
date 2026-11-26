// Run_Screen: the controls and status shown while a run is in progress.
// It drives the Map_Screen's dynamic layer through render/playback.ts.
// It holds no MIS logic. All dynamic text is set with textContent.

import type { DynamicLayer } from "../render/dynamic-layer";
import {
  PointStatus,
  apply,
  browserTiming,
  createPlayer,
  finalizeState,
  initialState,
  type Player,
  type PlaybackEvent,
  type PlaybackState,
} from "../render/playback";
import { DEFAULT_SPEED, SPEED_STEPS } from "../settings";
import { focusInside } from "../focus";

/** What the Run_Screen needs from the Map_Screen. */
export interface RunMapHandle {
  layer: DynamicLayer;
  /** Point ids, in the order of the layer's points. */
  ids: readonly string[];
  /** One polite live region message (round or run changes only). */
  announce(message: string): void;
}

export interface RunDeps {
  /** Run events in arrival order (client.ts `buffer`). */
  buffer: readonly PlaybackEvent[];
  /** True when the system asks for reduced motion. */
  reducedMotion(): boolean;
  /** The run finished with this result. */
  /** `hadFocus`: the run bar held focus, so the Tutor strip takes it. */
  onFinished(result: unknown, hadFocus: boolean): void;
  /** Back to the Map_Screen (after an error). */
  onBack(): void;
  /** Playback moved: `cursor` events of the buffer are applied. */
  onProgress?(cursor: number): void;
  /** The run ended with an error (the run button can be enabled again). */
  onStopped?(): void;
}

export interface RunView {
  el: HTMLElement;
  /** A run starts: call before the worker start message. Resets playback. */
  begin(map: RunMapHandle): void;
  /** The worker is still finishing a run that was stopped; this run starts right after it. */
  setWaiting(on: boolean): void;
  /** Move focus to the Skip to the end button (after a run began). */
  focusSkip(): void;
  /** Run progress events arrived. */
  wake(): void;
  /** The worker sent the result. */
  result(result: unknown): void;
  /** The worker sent a run error. */
  error(e: ErrorPayload): void;
  /** Redraw the final state after the map was laid out again (new size). */
  resync(): void;
  /** After a finished run: draw the run's own final map again (the Hybrid plan), no animation. */
  redrawFinal(): void;
  /** Leave the run view, stop playback. */
  hide(): void;
  readonly active: boolean;
  /** Number of buffered events already applied to the map. */
  readonly cursor: number;
}

/** Plain-words message for a run error. */
export function runErrorMessage(e: ErrorPayload): string {
  const items = Array.isArray(e.items)
    ? ` ${(e.items as unknown[]).map((x) => String(x)).join(", ")}`
    : "";
  return `The run could not finish. ${e.message}${items}`.trim();
}

function speedLabel(v: number): string {
  return `${v} steps per second`;
}

/** Shown while the worker finishes a stopped run before this one can start. */
export const WAITING_NOTE = "Finishing the run you stopped first. Your run starts right after it.";

export function createRunView(deps: RunDeps): RunView {
  let waitingNote: string | null = null;
  const el = document.createElement("section");
  el.className = "run-view";
  el.hidden = true;
  el.setAttribute("aria-label", "Run");

  const status = document.createElement("p");
  status.className = "run-status";
  status.tabIndex = -1;
  status.textContent = "Starting the run…";

  const controls = document.createElement("div");
  controls.className = "run-controls";

  const speedLabelEl = document.createElement("label");
  speedLabelEl.className = "run-speed";
  speedLabelEl.append("Speed ");
  const speedSelect = document.createElement("select");
  for (const v of SPEED_STEPS) {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = speedLabel(v);
    speedSelect.append(o);
  }
  speedSelect.value = String(DEFAULT_SPEED);
  speedLabelEl.append(speedSelect);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Next round";
  nextButton.hidden = true;

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.textContent = "Skip to the end";

  controls.append(speedLabelEl, nextButton, skipButton);

  const errorBox = document.createElement("div");
  errorBox.className = "error run-error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  const errorText = document.createElement("p");
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Back to the map";
  errorBox.append(errorText, backButton);

  el.append(status, controls, errorBox);

  // ---- run state ----
  let map: RunMapHandle | null = null;
  let player: Player | null = null;
  let resultIn = false;
  let resultValue: unknown = null;
  let finished = false;
  let failed = false;
  let active = false;
  let reduced = false;
  // Reduced motion: own cursor and state, one Round per step.
  let rState: PlaybackState | null = null;
  let rCursor = 0;
  let lastRound: number | null = null;

  const eventsPerSecond = (): number => Number(speedSelect.value) || DEFAULT_SPEED;

  /** Copy a playback state into the dynamic layer. */
  function sync(playState: PlaybackState, dtMs: number, instant: boolean): void {
    if (map === null) return;
    const layer = map.layer;
    // The final map: unpicked points become the hollow grey "5 GHz only" circle.
    const state = finished ? finalizeState(playState) : playState;
    const n = state.ids.length;
    let full = false;
    for (let i = 0; i < n; i++) {
      if (state.status[i] === PointStatus.Undecided && layer.status[i] !== PointStatus.Undecided) {
        full = true; // a new Round brought points back
        break;
      }
    }
    if (full) layer.reset();
    layer.setFinalView(finished);
    const still = instant || reduced || full;
    for (let i = 0; i < n; i++) {
      const s = state.status[i];
      if (layer.status[i] !== s) {
        if (s === PointStatus.Picked) layer.lock(i, state.channel[i], false, !still);
        else if (s === PointStatus.RulePicked) layer.lock(i, state.channel[i], true, !still, state.classical[i] === 1);
        else if (s === PointStatus.Removed) layer.remove(i, !still);
        else if (s === PointStatus.FiveGhzOnly) layer.setFiveGhzOnly(i);
      }
      if (s === PointStatus.Undecided && (state.glowTarget[i] > 0 || layer.glow[i] > 0)) {
        layer.setGlow(i, state.glowTarget[i]);
      }
    }
    layer.setTile(state.tile === null ? null : [...state.tile]);
    if (instant || reduced) layer.finishTweens();
    else layer.tick(dtMs);
    layer.draw();

    deps.onProgress?.(currentCursor());
    if (finished) return; // the final map stays as it is, the finished text stays
    status.textContent = state.statusLine || waitingNote || "Starting the run…";
    if (state.round !== null && state.round !== lastRound) {
      lastRound = state.round;
      map.announce(`Round ${state.round}.`);
    }
    tryFinish();
  }

  function currentCursor(): number {
    return reduced ? rCursor : (player?.cursor ?? 0);
  }

  function currentState(): PlaybackState | null {
    return reduced ? rState : (player?.state ?? null);
  }

  function drained(): boolean {
    if (reduced) return rState !== null && rCursor >= deps.buffer.length;
    return player !== null && player.cursor >= deps.buffer.length;
  }

  function tryFinish(): void {
    if (finished || failed || !active || !resultIn || !drained()) return;
    if (map !== null && map.layer.isAnimating()) return;
    finished = true;
    active = false;
    player?.stop();
    const hadFocus = focusInside(controls, document.activeElement);
    skipButton.disabled = true;
    nextButton.disabled = true;
    controls.hidden = true; // finished: the speed/skip bar goes (display:none, so nothing focusable stays)
    el.classList.add('run-done');
    const st = currentState();
    if (st !== null) sync(st, 0, true); // draw the final map, no tweens
    el.hidden = true; // the Tutor strip shows the finished line now
    map?.announce("The run is finished.");
    deps.onFinished(resultValue, hadFocus);
  }

  // ---- reduced motion steps ----
  /** End index of the next Round's events, or null while that Round is not complete. */
  function nextEnd(): number | null {
    const buf = deps.buffer;
    let r: number | null = null;
    for (let i = rCursor; i < buf.length; i++) {
      const e = buf[i];
      if (e.competitor !== "Hybrid") continue;
      if (r === null) r = e.round;
      else if (e.round !== r) return i;
    }
    return resultIn ? buf.length : null;
  }

  function updateNextButton(): void {
    if (!reduced || finished || failed) return;
    const ready = rCursor < deps.buffer.length && nextEnd() !== null;
    nextButton.disabled = !ready;
    if (!ready && rCursor < deps.buffer.length) status.textContent = "Waiting for the next round…";
  }

  function stepTo(end: number): void {
    if (rState === null) return;
    for (; rCursor < end; rCursor++) rState = apply(rState, deps.buffer[rCursor] as PlaybackEvent);
    sync(rState, 0, true);
    updateNextButton();
  }

  nextButton.addEventListener("click", () => {
    const end = nextEnd();
    if (end !== null) stepTo(end);
  });

  skipButton.addEventListener("click", () => {
    if (!active) return;
    if (reduced) stepTo(deps.buffer.length);
    else player?.skip();
    tryFinish();
  });

  backButton.addEventListener("click", () => {
    hide();
    deps.onBack();
  });

  function hide(): void {
    player?.stop();
    player = null;
    active = false;
    map = null;
    el.hidden = true;
  }

  return {
    el,
    get active() {
      return active;
    },
    setWaiting(on) {
      waitingNote = on ? WAITING_NOTE : null;
      if (on && !finished) status.textContent = WAITING_NOTE;
    },
    begin(m) {
      waitingNote = null;
      player?.stop();
      map = m;
      resultIn = false;
      resultValue = null;
      finished = false;
      failed = false;
      active = true;
      lastRound = null;
      reduced = deps.reducedMotion();
      rCursor = 0;
      m.layer.reset();
      errorBox.hidden = true;
      controls.hidden = false;
      el.classList.remove('run-done');
      skipButton.disabled = false;
      nextButton.hidden = !reduced;
      nextButton.disabled = true;
      speedLabelEl.hidden = reduced;
      status.textContent = "Starting the run…";
      el.hidden = false;
      m.announce("Run started.");
      const initial = initialState(m.ids);
      rState = initial;
      if (reduced) {
        player = null;
      } else {
        player = createPlayer({
          buffer: deps.buffer,
          initial,
          eventsPerSecond,
          resultReceived: () => resultIn,
          draw: sync,
          isAnimating: () => m.layer.isAnimating(),
          ...browserTiming(),
        });
        player.reset();
      }
    },
    focusSkip() {
      if (!skipButton.disabled && !controls.hidden && !el.hidden) skipButton.focus();
    },
    wake() {
      if (!active) return;
      if (reduced) updateNextButton();
      else player?.wake();
    },
    result(r) {
      if (!active) return;
      resultIn = true;
      resultValue = r;
      if (reduced) {
        updateNextButton();
        tryFinish();
      } else {
        player?.wake();
        tryFinish();
      }
    },
    error(e) {
      if (!active) return;
      failed = true;
      active = false;
      player?.stop();
      controls.hidden = true;
      errorText.textContent = runErrorMessage(e);
      errorBox.hidden = false;
      status.textContent = "The run stopped.";
      map?.announce("The run stopped with an error.");
      backButton.focus();
      deps.onStopped?.();
    },
    resync() {
      if (map === null || (el.hidden && !finished)) return;
      const st = currentState();
      if (st !== null) sync(st, 0, true);
    },
    redrawFinal() {
      if (map === null || !finished) return;
      const st = currentState();
      if (st === null) return;
      map.layer.reset(); // another plan may have been drawn: start from a clean layer
      sync(st, 0, true);
    },
    get cursor() {
      return currentCursor();
    },
    hide,
  };
}
