// Shared message types for the AtomMap worker (design.md, "Worker message API").
//
// This file is a plain script (no import/export) on purpose: the worker is a
// classic worker that uses importScripts() for pyodide.js, and a classic worker
// cannot run ES module syntax. The types below are global declarations.
//
// Every message is { type, payload }. The worker never changes a payload.

type LoadStage = "pyodide" | "engine" | "packages" | "boot" | "warmup";

interface StartPayload {
  // The run request. The worker JSON.stringify's it once and never looks inside.
  // Units: x, y and graph.r are in metres.
  points: { id: string; x: number; y: number }[];
  mode: string;
  graph: { r: number; edges?: [string, string][] };
  seed: number;
  // Lab only (experience spec, Requirement 17). Absent means the measured defaults.
  settings?: { shots?: number; top_share?: number };
}

interface ProgressLoadPayload {
  stage: LoadStage;
  percent: number; // 0..100, never decreases
  detail?: string; // extra text for diagnosis, e.g. "verify", "wheel amazon-braket-sdk"
}

// Run progress: the engine's event dict, forwarded unchanged. It has type "run";
// loading progress has "stage" instead.
interface ProgressRunPayload {
  type: "run";
  kind: "simulate" | "pick" | "frequencies" | "shots";
  competitor: string;
  round: number;
  step: number;
  tile?: string[] | null; // simulate: ids sent to the simulator; otherwise null or absent
  picked?: string[]; // pick only
  source?: string; // pick only: "atoms" | "annealing" | "coin flip" | "rule"
  removed?: string[]; // pick only: neighbours removed by the pick
  frequencies?: Record<string, number>; // frequencies only: id -> how often picked in the shots (0..1)
  // shots only: one list per shot, in Simulator order, with the indexes into `tile` of the
  // Points kept after repair. The share of lists that contain an index is that Point's frequency.
  kept?: number[][];
}

// Sent as soon as one Competitor has finished, before the final "result".
// `result` is the same entry that later sits in result.competitors[competitor]
// (a competitor result object, or {error: text}).
interface CompetitorDonePayload {
  competitor: string;
  result: any;
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
  [extra: string]: unknown; // engine errors carry kind, items, ...
}

// A failed run posts the engine error object unchanged (it may carry kind, items, ...).
type ToWorkerMessage = { type: "start"; payload: StartPayload };

type FromWorkerMessage =
  | { type: "progress"; payload: ProgressLoadPayload | ProgressRunPayload }
  | { type: "ready"; payload: ReadyPayload }
  | { type: "competitor_done"; payload: CompetitorDonePayload } // one Competitor finished
  | { type: "result"; payload: any } // the "result" object of atommap.api.run, as parsed
  | { type: "error"; payload: ErrorPayload };
