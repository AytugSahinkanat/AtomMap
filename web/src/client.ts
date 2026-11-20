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

export interface ClientCallbacks {
  onLoadProgress?: (p: ProgressLoadPayload) => void;
  onReady?: (p: ReadyPayload) => void;
  onResult?: (result: any) => void;
  onError?: (e: ErrorPayload) => void;
}

export interface WorkerClient {
  start(payload: StartPayload): void;
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

  worker.onmessage = (ev: MessageEvent<FromWorkerMessage>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "progress":
        if (isRunProgress(msg.payload)) buffer.push(msg.payload);
        else cb.onLoadProgress?.(msg.payload);
        break;
      case "ready":
        cb.onReady?.(msg.payload);
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
      const m: ToWorkerMessage = { type: "start", payload };
      worker.postMessage(m);
    },
    terminate() {
      worker.terminate();
    },
  };
}
