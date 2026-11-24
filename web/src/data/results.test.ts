import { describe, expect, it } from 'vitest';
// The raw text of the committed file, read from disk at test time.
import committedText from '../../public/results.json?raw';
import { validateResults, type ResultsFile } from './results';

const committed: unknown = JSON.parse(committedText);

function clone(): any {
  return JSON.parse(JSON.stringify(committed));
}

function reasonOf(json: unknown): string {
  const r = validateResults(json);
  if (r.ok) throw new Error('expected the file to be rejected');
  return r.reason;
}

describe('validateResults on the committed results.json', () => {
  it('accepts it', () => {
    expect(validateResults(committed).ok).toBe(true);
  });

  it('is marked as example data', () => {
    const r = validateResults(committed);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.example).toBe(true);
  });

  it('has a failed run with a reason', () => {
    const v = committed as ResultsFile;
    const failed = v.runs.filter((x) => x.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    for (const f of failed) expect((f.reason ?? '').length).toBeGreaterThan(0);
  });

  it('has a run with 0 quantum share and atoms_not_needed true', () => {
    const v = committed as ResultsFile;
    expect(
      v.runs.some((x) => x.atoms_not_needed && x.quantum_share.Hybrid === 0),
    ).toBe(true);
  });

  it('names the three maps', () => {
    const v = committed as ResultsFile;
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
