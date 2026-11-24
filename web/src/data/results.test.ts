import { describe, expect, it } from 'vitest';
// The raw text of the committed file, read from disk at test time.
import committedText from '../../public/results.json?raw';
// A fixed example file (example true, 4 runs), kept as a test fixture.
import exampleText from '../../test-data/results.example.json?raw';
import { validateResults, type ResultsFile } from './results';

const committed: unknown = JSON.parse(committedText);
const example: unknown = JSON.parse(exampleText);

function clone(): any {
  return JSON.parse(JSON.stringify(example));
}

function reasonOf(json: unknown): string {
  const r = validateResults(json);
  if (r.ok) throw new Error('expected the file to be rejected');
  return r.reason;
}

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe('the committed results.json (any honest measurement)', () => {
  it('validates and is not example data', () => {
    const r = validateResults(committed);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.example).toBe(false);
  });
  it('has 30 runs in protocol order', () => {
    const v = committed as ResultsFile;
    const expected: [string, number][] = [];
    for (const m of ['Wifi hall', 'Wifi hall, sparse control', 'Kadıköy, Istanbul']) {
      for (let s = 1; s <= 10; s++) expected.push([m, s]);
    }
    expect(v.runs.map((x) => [x.map, x.seed])).toEqual(expected);
  });
  it('says splits, skipped tiles and atoms not needed are the hybrid\'s', () => {
    const v = committed as ResultsFile;
    expect(v.protocol.text).toMatch(/atoms not needed, splits and skipped tiles are the hybrid's/);
  });
  it('has no keys named like time, duration or seconds', () => {
    for (const k of keysOf(committed)) {
      const tokens = k.toLowerCase().split(/[^a-z]+/);
      for (const bad of ['time', 'times', 'duration', 'seconds', 'secs', 'sec', 'ms', 'millis']) {
        expect(tokens, k).not.toContain(bad);
      }
    }
  });
});

describe('validateResults on the example fixture', () => {
  it('accepts it', () => {
    expect(validateResults(example).ok).toBe(true);
  });
  it('is marked as example data', () => {
    const r = validateResults(example);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.example).toBe(true);
  });
  it('has a failed run with a reason', () => {
    const v = example as ResultsFile;
    const failed = v.runs.filter((x) => x.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    for (const f of failed) expect((f.reason ?? '').length).toBeGreaterThan(0);
  });
  it('has a run with 0 quantum share and atoms_not_needed true', () => {
    const v = example as ResultsFile;
    expect(
      v.runs.some((x) => x.atoms_not_needed && x.quantum_share.Hybrid === 0),
    ).toBe(true);
  });
  it('names the three maps', () => {
    const v = example as ResultsFile;
    const names = new Set(v.runs.map((x) => x.map));
    for (const n of ['Wifi hall', 'Wifi hall, sparse control', 'Kadıköy, Istanbul']) {
      expect(names.has(n)).toBe(true);
    }
  });
});
describe('validateResults rejections', () => {
  it('rejects non-objects', () => {
    for (const v of [null, 5, 'x', [], undefined]) {
      expect(reasonOf(v)).toMatch(/must be an object/);
    }
  });

  it('rejects wrong top-level types', () => {
    let j = clone();
    j.example = 'yes';
    expect(reasonOf(j)).toMatch(/^example must be true or false/);
    j = clone();
    j.protocol = 'text';
    expect(reasonOf(j)).toMatch(/^protocol must be an object/);
    j = clone();
    j.protocol.text = 3;
    expect(reasonOf(j)).toMatch(/^protocol\.text must be text/);
    j = clone();
    j.protocol.settings = [];
    expect(reasonOf(j)).toMatch(/^protocol\.settings must be an object/);
    j = clone();
    j.runs = {};
    expect(reasonOf(j)).toMatch(/^runs must be a list/);
  });

  it('rejects missing top-level fields', () => {
    for (const key of ['example', 'protocol', 'runs']) {
      const j = clone();
      delete j[key];
      expect(reasonOf(j)).toContain(key);
    }
  });

  it('accepts the optional how-made fields and rejects them when they are not text', () => {
    let j = clone();
    Object.assign(j, { date: '2026-01-02', commit: 'abc dirty', chromium: '140.0.1', pyodide: '0.27.7' });
    expect(validateResults(j).ok).toBe(true);
    for (const key of ['date', 'commit', 'chromium', 'pyodide']) {
      j = clone();
      j[key] = 5;
      expect(reasonOf(j)).toBe(`${key} must be text.`);
    }
  });

  it('rejects a bad status with a sentence naming the run and field', () => {
    const j = clone();
    j.runs[2].status = 'great';
    expect(reasonOf(j)).toBe('run 3: status must be ok, failed or bad.');
  });

  it('rejects a run that is not an object', () => {
    const j = clone();
    j.runs[0] = 7;
    expect(reasonOf(j)).toBe('run 1: the run must be an object.');
  });

  it('rejects wrong field types in a run', () => {
    const cases: [string, unknown][] = [
      ['seed', 'one'],
      ['map', 4],
      ['atoms_not_needed', 'no'],
      ['splits', '0'],
      ['skipped_tiles', null],
      ['reason', 5],
    ];
    for (const [field, value] of cases) {
      const j = clone();
      j.runs[0][field] = value;
      const reason = reasonOf(j);
      expect(reason.startsWith('run 1: ' + field)).toBe(true);
    }
  });

  it('rejects missing run fields, naming the field', () => {
    for (const field of ['seed', 'map', 'picks', 'quantum_share', 'atoms_not_needed', 'splits', 'skipped_tiles', 'status']) {
      const j = clone();
      delete j.runs[1][field];
      expect(reasonOf(j).startsWith('run 2: ' + field)).toBe(true);
    }
  });

  it('rejects negative or non-integer counts', () => {
    for (const field of ['seed', 'splits', 'skipped_tiles']) {
      for (const bad of [-1, 1.5, Number.NaN]) {
        const j = clone();
        j.runs[0][field] = bad;
        expect(reasonOf(j)).toBe(`run 1: ${field} must be a whole number, zero or more.`);
      }
    }
    for (const bad of [-1, 2.5]) {
      const j = clone();
      j.runs[0].picks.Hybrid = bad;
      expect(reasonOf(j)).toBe('run 1: picks.Hybrid must be a whole number, zero or more.');
    }
  });

  it('rejects missing competitor names in picks and quantum_share', () => {
    for (const field of ['picks', 'quantum_share']) {
      for (const name of ['Atoms_Alone', 'Hybrid', 'Annealing_Rules', 'Coin_Flip_Rules']) {
        const j = clone();
        delete j.runs[3][field][name];
        expect(reasonOf(j).startsWith(`run 4: ${field}.${name} must be`)).toBe(true);
      }
    }
  });

  it('rejects a non-numeric quantum share', () => {
    const j = clone();
    j.runs[0].quantum_share.Hybrid = 'high';
    expect(reasonOf(j)).toBe('run 1: quantum_share.Hybrid must be a number.');
  });

  it('rejects picks that are not an object', () => {
    const j = clone();
    j.runs[0].picks = [1, 2, 3, 4];
    expect(reasonOf(j)).toMatch(/^run 1: picks must be an object/);
  });
});
