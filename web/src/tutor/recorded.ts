// Recorded run loader (tutor spec, task 2.2). Test helper, not used by the app.
//
// The files are written by `scripts/record_tutor_runs.py` and committed by the
// user: web/test-data/tutor/<name>.json as {request, events, result}.
// Until a file exists, `loadRecorded(name)` returns null. Nothing is invented.
//
// `import.meta.glob` (Vite) is used so that a missing file is an empty match,
// not an import error, and so no Node types are needed.

export const RECORDED_NAMES = [
  "hero_seed1",
  "sparse_seed1",
  "rules_only",
  "place_rules_only",
] as const;

export type RecordedName = (typeof RECORDED_NAMES)[number];

/** One progress event as the Engine emits it (plus `type` and `competitor`). */
export interface RecordedEvent {
  type?: string;
  competitor?: string;
  kind: string;
  round?: number;
  step?: number;
  tile?: string[] | null;
  picked?: string[];
  removed?: string[];
  source?: string;
  [key: string]: unknown;
}

export interface RecordedRun {
  request: {
    points: { id: string; x: number; y: number }[];
    mode: "channel_plan" | "place";
    graph?: { r?: number };
    seed: number;
    [key: string]: unknown;
  };
  events: RecordedEvent[];
  result: {
    competitors: Record<string, any>;
    [key: string]: unknown;
  };
}

/** Repo-relative path, used in skip messages. */
export function recordedPath(name: string): string {
  return `web/test-data/tutor/${name}.json`;
}

const files = import.meta.glob("../../test-data/tutor/*.json", {
  eager: true,
  import: "default",
}) as Record<string, RecordedRun>;

/** The parsed recording, or null when the file is missing. */
export function loadRecorded(name: string): RecordedRun | null {
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}.json`));
  return key === undefined ? null : files[key];
}

/** Title for a test over one recording: names the file when it is missing. */
export function recordedTitle(name: string, title: string): string {
  return loadRecorded(name) === null
    ? `${title} [SKIPPED: ${recordedPath(name)} is missing, run scripts/record_tutor_runs.py]`
    : title;
}

/** Events of the Hybrid Competitor, in arrival order. */
export function hybridEvents(run: RecordedRun): RecordedEvent[] {
  return run.events.filter((e) => e.competitor === "Hybrid");
}
