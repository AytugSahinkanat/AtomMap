// Typed client for the AtomMap worker (design.md, "Worker message protocol").
//
// The message types (StartPayload, FromWorkerMessage, ...) are globals declared
// in worker/src/messages.ts, which is a plain script with no exports. It is
// listed in tsconfig "include", so they are visible here without an import.
//
// Run progress events are only appended to `buffer`. The client does no drawing
// and keeps no UI state. Playback reads `buffer` later.

export type RunEvent = ProgressRunPayload;

/** Run progress events, in arrival order. Cleared by startRun(). */
export const buffer: RunEvent[] = [];

/** Finished Competitors of the current run, by engine name. Cleared by start(). */
export const doneCompetitors: Record<string, any> = {};

export interface ClientCallbacks {
  onLoadProgress?: (p: ProgressLoadPayload) => void;
  /** Called after a run progress event was appended to `buffer`. */
  onRunEvent?: (ev: RunEvent) => void;
  onReady?: (p: ReadyPayload) => void;
  /** One Competitor finished; its entry is also in `doneCompetitors`. */
  onCompetitorDone?: (competitor: string, result: any) => void;
  onResult?: (result: any) => void;
  onError?: (e: ErrorPayload) => void;
}

export interface WorkerClient {
  /** Returns true when the run waits for a stopped run to end first. */
  start(payload: StartPayload): boolean;
  /**
   * Drop the run in progress (the back button during a run). The worker cannot stop a run
   * halfway, so it finishes it; every message of that run is dropped here, and a run started
   * meanwhile is sent when the dropped run has ended.
   */
  cancel(): void;
  terminate(): void;
}

// The worker is a classic worker (importScripts).
// Built site: worker.js sits next to index.html, so it is resolved against the page URL.
// That works from any sub path (for example /AtomMap/). No absolute path is used.
// Vite dev server: same default path as web/smoke.html.
export const DEFAULT_WORKER_URL: string = import.meta.env.DEV
  ? "../worker/dist/worker.js"
  : new URL("worker.js", document.baseURI).href;

export function isRunProgress(
  p: ProgressLoadPayload | ProgressRunPayload,
): p is ProgressRunPayload {
  return (p as ProgressRunPayload).type === "run";
}

export function createClient(
  cb: ClientCallbacks = {},
  url: string = DEFAULT_WORKER_URL,
): WorkerClient {
  const worker = new Worker(url); // classic worker (importScripts)
  /** A run was sent and its result or error has not come back yet. */
  let inFlight = false;
  /** The run in flight was cancelled: drop its messages until it ends. */
  let dropping = false;
  /** A run started while a cancelled one was still being finished by the worker. */
  let pending: StartPayload | null = null;

  function send(payload: StartPayload): void {
    inFlight = true;
    const m: ToWorkerMessage = { type: "start", payload };
    worker.postMessage(m);
  }

  worker.onmessage = (ev: MessageEvent<FromWorkerMessage>) => {
    const msg = ev.data;
    const ofRun = msg.type === "result" || msg.type === "competitor_done" || (msg.type === "error" && inFlight) ||
      (msg.type === "progress" && isRunProgress(msg.payload));
    const ends = inFlight && (msg.type === "result" || msg.type === "error");
    if (ends) inFlight = false;
    if (dropping && ofRun) {
      if (ends) {
        dropping = false;
        if (pending) {
          const next = pending;
          pending = null;
          send(next);
        }
      }
      return;
    }
    switch (msg.type) {
      case "progress":
        if (isRunProgress(msg.payload)) {
          buffer.push(msg.payload);
          cb.onRunEvent?.(msg.payload);
        }
        else cb.onLoadProgress?.(msg.payload);
        break;
      case "ready":
        cb.onReady?.(msg.payload);
        break;
      case "competitor_done":
        doneCompetitors[msg.payload.competitor] = msg.payload.result;
        cb.onCompetitorDone?.(msg.payload.competitor, msg.payload.result);
        break;
      case "result":
        cb.onResult?.(msg.payload);
        break;
      case "error":
        cb.onError?.(msg.payload);
        break;
    }
  };

  worker.onerror = (ev: ErrorEvent) => {
    cb.onError?.({ type: "Error", message: ev.message || "The worker failed to load." });
  };

  return {
    start(payload: StartPayload) {
      buffer.length = 0;
      for (const k of Object.keys(doneCompetitors)) delete doneCompetitors[k];
      if (dropping) {
        pending = payload; // sent when the cancelled run has ended
        return true;
      }
      send(payload);
      return false;
    },
    cancel() {
      if (inFlight) dropping = true;
      pending = null;
    },
    terminate() {
      worker.terminate();
    },
  };
}
