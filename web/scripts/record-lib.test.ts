import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import * as lib from './record-lib.mjs';
import { validateResults } from '../src/data/results';

const { COMPETITORS, assembleFile, assembleRecord, buildSettings, checkCompetitor, commitLabel, percentOne, planRuns, readPyNumber } = lib;

// Four points in a line: a-b and b-c are edges. d is free.
const request = {
  points: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: i, y: 0 })),
  mode: 'channel_plan',
  seed: 1,
  graph: { r: 1, edges: [['a', 'b'], ['b', 'c']] },
};

function entry(rounds: string[][], extra: Record<string, unknown> = {}) {
  return {
    rounds: rounds.map((picks, i) => ({ channel: [1, 6, 11][i], picks })),
    stats: { total_picks: rounds.flat().length, quantum_share: 0.171, atoms_not_needed: false, splits: 2, skipped_tiles: 1, ...extra },
  };
}
function competitors(e: unknown, hybrid: unknown = e) {
  return Object.fromEntries(COMPETITORS.map((n: string) => [n, n === 'Hybrid' ? hybrid : e]));
}
const failing = (checks: { ok: boolean; check: string }[]) => checks.filter((c) => !c.ok).map((c) => c.check);

describe('checkCompetitor', () => {
  it('passes a clean result', () => {
    expect(failing(checkCompetitor('Hybrid', entry([['a', 'c'], ['b'], ['d']]), request))).toEqual([]);
  });
  it('finds an unknown id', () => {
    expect(failing(checkCompetitor('Hybrid', entry([['zzz']]), request))).toEqual(['known ids']);
  });
  it('finds two picked points that share an edge in one round', () => {
    expect(failing(checkCompetitor('Hybrid', entry([['a', 'b']]), request))).toEqual(['shared edge']);
  });
  it('allows an edge across two rounds', () => {
    expect(failing(checkCompetitor('Hybrid', entry([['a'], ['b']]), request))).toEqual([]);
  });
  it('finds a point picked in two rounds, and twice in one round', () => {
    expect(failing(checkCompetitor('Hybrid', entry([['a'], ['a']]), request))).toEqual(['double pick']);
    expect(failing(checkCompetitor('Hybrid', entry([['d', 'd']]), request))).toEqual(['double pick']);
  });
  it('fails all three checks when there is no rounds list', () => {
    expect(failing(checkCompetitor('Hybrid', {}, request)).length).toBe(3);
  });
});

describe('percentOne', () => {
  it('rounds like formatPercent: one decimal, 0 stays 0', () => {
    expect(percentOne(0)).toBe(0);
    expect(percentOne(0.171)).toBe(17.1);
    expect(percentOne(0.1714)).toBe(17.1);
    expect(percentOne(0.1716)).toBe(17.2);
    expect(percentOne(1)).toBe(100);
    expect(percentOne(6 / 35)).toBe(17.1);
  });
});

describe('commitLabel', () => {
  it('adds " dirty" only when porcelain is not empty', () => {
    expect(commitLabel('abc123\n', '')).toBe('abc123');
    expect(commitLabel('abc123\n', ' \n')).toBe('abc123');
    expect(commitLabel('abc123\n', ' M web/src/x.ts\n')).toBe('abc123 dirty');
  });
});

describe('readPyNumber', () => {
  it('reads plain constants and fails when missing', () => {
    const src = 'STEPS = 400\nSHOTS = 100  # per tile\nTOP_SHARE = 0.4\nDURATION_S = 4e-6\n';
    expect(readPyNumber(src, 'STEPS')).toBe(400);
    expect(readPyNumber(src, 'SHOTS')).toBe(100);
    expect(readPyNumber(src, 'TOP_SHARE')).toBe(0.4);
    expect(() => readPyNumber(src, 'MAX_TILE')).toThrow(/MAX_TILE/);
  });
});

describe('planRuns', () => {
  it('is 30 runs, maps in order, seeds 1 to 10 each', () => {
    const p = planRuns();
    expect(p.length).toBe(30);
    expect(p[0]).toEqual({ map: 'Wifi hall', seed: 1 });
    expect(p[9]).toEqual({ map: 'Wifi hall', seed: 10 });
    expect(p[10]).toEqual({ map: 'Wifi hall, sparse control', seed: 1 });
    expect(p[29]).toEqual({ map: 'Kadıköy, Istanbul', seed: 10 });
  });
});

describe('assembleRecord', () => {
  const good = entry([['a', 'c'], ['b'], ['d']]);

  it('builds an ok record from the hybrid stats', () => {
    const { record } = assembleRecord({ map: 'Wifi hall', seed: 3, request, outcome: { result: { competitors: competitors(good) } } });
    expect(record).toEqual({
      seed: 3,
      map: 'Wifi hall',
      picks: { Atoms_Alone: 4, Hybrid: 4, Annealing_Rules: 4, Coin_Flip_Rules: 4 },
      quantum_share: { Atoms_Alone: 17.1, Hybrid: 17.1, Annealing_Rules: 17.1, Coin_Flip_Rules: 17.1 },
      atoms_not_needed: false,
      splits: 2,
      skipped_tiles: 1,
      status: 'ok',
    });
  });

  it('takes splits, skipped tiles and atoms_not_needed from the Hybrid only', () => {
    const hybrid = entry([['a', 'c']], { splits: 7, skipped_tiles: 5, atoms_not_needed: true, quantum_share: 0 });
    const { record } = assembleRecord({ map: 'm', seed: 1, request, outcome: { result: { competitors: competitors(good, hybrid) } } });
    expect([record.splits, record.skipped_tiles, record.atoms_not_needed, record.quantum_share.Hybrid]).toEqual([7, 5, true, 0]);
    expect(record.quantum_share.Atoms_Alone).toBe(17.1);
  });

  it('marks a run bad, naming the competitor and the check, and keeps the numbers', () => {
    const badEntry = entry([['a', 'b']]);
    const { record } = assembleRecord({
      map: 'm', seed: 1, request,
      outcome: { result: { competitors: { ...competitors(good), Annealing_Rules: badEntry } } },
    });
    expect(record.status).toBe('bad');
    expect(record.reason).toMatch(/^Annealing_Rules failed the check "shared edge"/);
    expect(record.picks.Annealing_Rules).toBe(2);
  });

  it('marks a run failed when a competitor returns an error', () => {
    const { record, checks } = assembleRecord({
      map: 'm', seed: 1, request,
      outcome: { result: { competitors: { ...competitors(good), Atoms_Alone: { error: 'SimulatorError: no layout' } } } },
    });
    expect(record.status).toBe('failed');
    expect(record.reason).toBe('Atoms_Alone could not finish: no layout');
    expect(Object.values(record.picks)).toEqual([0, 0, 0, 0]);
    expect(checks).toEqual([]);
  });

  it('marks a run failed on a worker error or a missing competitor', () => {
    expect(assembleRecord({ map: 'm', seed: 2, request, outcome: { error: 'the run took longer than 10 minutes' } }).record)
      .toMatchObject({ status: 'failed', reason: 'the run took longer than 10 minutes', seed: 2 });
    const missing = { ...competitors(good) };
    delete missing.Hybrid;
    expect(assembleRecord({ map: 'm', seed: 1, request, outcome: { result: { competitors: missing } } }).record.reason)
      .toBe('Hybrid returned no result');
  });
});

describe('assembleFile', () => {
  it('has the protocol, settings and how-made fields, and passes validateResults', () => {
    const good = entry([['a', 'c'], ['b'], ['d']]);
    const runs = planRuns().slice(0, 2).map(({ map, seed }: { map: string; seed: number }) =>
      assembleRecord({ map, seed, request, outcome: { result: { competitors: competitors(good) } } }).record);
    const settings = buildSettings({ shots: 100, steps: 400, tile_size: 10, top_group_share: 0.4 });
    const file = assembleFile({ settings, runs, date: '2026-01-02', commit: 'abc dirty', chromium: '140.0.1', pyodide: '0.27.7' });
    expect(file.example).toBe(false);
    expect(file.protocol.text).toMatch(/hybrid's/);
    expect(file.protocol.text).toMatch(/10 minutes/);
    expect(file.protocol.settings).toMatchObject({ shots: 100, steps: 400, tile_size: 10, top_group_share: 0.4 });
    expect(file.runs.length).toBe(2);
    expect(JSON.stringify({ runs: file.runs, settings: file.protocol.settings })).not.toMatch(/duration|elapsed|_ms|seconds/i);
    expect(validateResults(file).ok).toBe(true);
  });
});

describe('compareRecords (--check)', () => {
  const rec = (seed: number, hybrid: number, share = 19.4) => ({
    seed,
    map: 'Wifi hall',
    picks: { Atoms_Alone: 25, Hybrid: hybrid, Annealing_Rules: 35, Coin_Flip_Rules: 33 },
    quantum_share: { Atoms_Alone: 100, Hybrid: share, Annealing_Rules: 0, Coin_Flip_Rules: 0 },
    atoms_not_needed: false,
    splits: 13,
    skipped_tiles: 0,
    status: 'ok',
  });

  it('is empty when every run is the same', () => {
    expect(lib.compareRecords([rec(1, 31), rec(2, 30)], [rec(1, 31), rec(2, 30)])).toEqual([]);
  });

  it('names the run, the field and both values of every difference', () => {
    expect(lib.compareRecords([rec(1, 31)], [rec(1, 32, 18.8)])).toEqual([
      'run 1 (Wifi hall, seed 1): picks of Hybrid was 31, now 32',
      'run 1 (Wifi hall, seed 1): quantum_share of Hybrid was 19.4, now 18.8',
    ]);
    const failed = { ...rec(1, 31), status: 'failed', reason: 'timeout' };
    expect(lib.compareRecords([rec(1, 31)], [failed])).toEqual([
      'run 1 (Wifi hall, seed 1): status was "ok", now "failed"',
      'run 1 (Wifi hall, seed 1): reason was undefined, now "timeout"',
    ]);
  });

  it('reports a different number of runs', () => {
    expect(lib.compareRecords([rec(1, 31), rec(2, 30)], [rec(1, 31)])[0]).toBe('the file has 2 runs, the check made 1');
  });

  it('the committed results.json compares equal with itself', () => {
    const file = JSON.parse(readFileSync(new URL('../public/results.json', import.meta.url), 'utf8'));
    expect(lib.compareRecords(file.runs, structuredClone(file.runs))).toEqual([]);
  });
});

describe('settingsProblem', () => {
  it('refuses a request with lab settings, even the defaults', () => {
    expect(lib.settingsProblem({ seed: 1, settings: { shots: 100, top_share: 0.4 } })).toMatch(/lab settings/);
    expect(lib.settingsProblem({ seed: 1, settings: {} })).toMatch(/lab settings/);
    expect(lib.settingsProblem({ seed: 1 })).toBeNull();
  });
});
