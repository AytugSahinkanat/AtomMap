// Shared message types for the AtomMap worker (design.md, "Worker message API").
//
// This file is a plain script (no import/export) on purpose: the worker is a
// classic worker that uses importScripts() for pyodide.js, and a classic worker
// cannot run ES module syntax. The types below are global declarations.
//
// Every message is { type, payload }. The worker never changes a payload.

type LoadStage = "pyodide" | "engine" | "packages" | "boot" | "warmup";

interface StartPayload {
  // Filled in by task 10. The worker forwards it to Python unchanged.
  points: { id: string; x: number; y: number }[];
  mode: string;
  graph: { r: number; edges?: [string, string][] };
  seed: number;
}

interface ProgressLoadPayload {
  stage: LoadStage;
  percent: number; // 0..100, never decreases
  detail?: string; // extra text for diagnosis, e.g. "verify", "wheel amazon-braket-sdk"
}

interface ProgressRunPayload {
  competitor: string;
  round: number;
  step: number;
  tile: number;
}

interface ReadyPayload {
  elapsedMs: number;
  lean: boolean;
}

interface ErrorPayload {
  type: string; // e.g. "BootError", "PythonError", "Error"
  message: string;
  dependency?: string; // set when the failure names a dependency
  stage?: LoadStage;
}

type ToWorkerMessage = { type: "start"; payload: StartPayload };

type FromWorkerMessage =
  | { type: "progress"; payload: ProgressLoadPayload | ProgressRunPayload }
  | { type: "ready"; payload: ReadyPayload }
  | { type: "result"; payload: string } // JSON string from atommap.api.run
  | { type: "error"; payload: ErrorPayload };
