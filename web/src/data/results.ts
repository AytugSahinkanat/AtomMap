// Results file types, validator and loader (ui spec, Requirement 13).
// validateResults is pure. loadResults makes the one same-origin request
// the Results page needs. No MIS logic here.

import { CARD_ORDER, type EngineName } from '../scoreboard-model';

export type RunStatus = 'ok' | 'failed' | 'bad';

export interface RunRecord {
  seed: number;
  map: string;
  picks: Record<EngineName, number>;
  quantum_share: Record<EngineName, number>;
  atoms_not_needed: boolean;
  splits: number;
  skipped_tiles: number;
  status: RunStatus;
  reason?: string;
}

export interface ResultsFile {
  example: boolean;
  protocol: { text: string; settings: Record<string, unknown> };
  runs: RunRecord[];
}

export type ValidateResult =
  | { ok: true; value: ResultsFile }
  | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Returns a plain sentence for the first problem in a run, or null. */
function checkRun(r: unknown, n: number): string | null {
  const p = `run ${n}: `;
  if (!isRecord(r)) return `${p}the run must be an object`;
  if (!isCount(r.seed)) return `${p}seed must be a whole number, zero or more`;
  if (typeof r.map !== 'string') return `${p}map must be text`;
  for (const field of ['picks', 'quantum_share'] as const) {
    const m = r[field];
    if (!isRecord(m)) return `${p}${field} must be an object with the four competitor names`;
    for (const name of CARD_ORDER) {
      const v = m[name];
      if (field === 'picks' ? !isCount(v) : !isNumber(v)) {
        return field === 'picks'
          ? `${p}${field}.${name} must be a whole number, zero or more`
          : `${p}${field}.${name} must be a number`;
      }
    }
  }
  if (typeof r.atoms_not_needed !== 'boolean') return `${p}atoms_not_needed must be true or false`;
  if (!isCount(r.splits)) return `${p}splits must be a whole number, zero or more`;
  if (!isCount(r.skipped_tiles)) return `${p}skipped_tiles must be a whole number, zero or more`;
  if (r.status !== 'ok' && r.status !== 'failed' && r.status !== 'bad') {
    return `${p}status must be ok, failed or bad`;
  }
  if (r.reason !== undefined && typeof r.reason !== 'string') return `${p}reason must be text`;
  return null;
}

/** Checks the shape of a results file. Returns the first problem as a plain sentence. */
export function validateResults(json: unknown): ValidateResult {
  const bad = (reason: string): ValidateResult => ({ ok: false, reason });
  if (!isRecord(json)) return bad('The results file must be an object.');
  if (typeof json.example !== 'boolean') return bad('example must be true or false.');
  const protocol = json.protocol;
  if (!isRecord(protocol)) return bad('protocol must be an object.');
  if (typeof protocol.text !== 'string') return bad('protocol.text must be text.');
  if (!isRecord(protocol.settings)) return bad('protocol.settings must be an object.');
  if (!Array.isArray(json.runs)) return bad('runs must be a list.');
  for (let i = 0; i < json.runs.length; i++) {
    const problem = checkRun(json.runs[i], i + 1);
    if (problem) return bad(problem + '.');
  }
  return { ok: true, value: json as unknown as ResultsFile };
}

/** Fetches ./results.json (same origin) and validates it. */
export async function loadResults(): Promise<ValidateResult> {
  let res: Response;
  try {
    res = await fetch('./results.json');
  } catch {
    return { ok: false, reason: 'The results file could not be loaded.' };
  }
  if (!res.ok) return { ok: false, reason: `The results file could not be loaded (status ${res.status}).` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'The results file is not valid JSON.' };
  }
  return validateResults(json);
}
