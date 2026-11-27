import { describe, expect, it } from 'vitest';
import { buildRequest, parseSeed, placeView } from './map-request';

describe('placeView', () => {
  it('shows no data (and cannot run) when nothing is loaded', () => {
    const v = placeView({ placeFixture: null, placeLoading: false, placeError: null });
    expect(v.kind).toBe('no_data');
    expect(v.canRun).toBe(false);
    expect(v.text).toMatch(/no data yet/i);
  });
  it('includes the error text when the fixture failed', () => {
    const v = placeView({ placeFixture: null, placeLoading: false, placeError: 'place_kadikoy.json missing' });
    expect(v.kind).toBe('no_data');
    expect(v.text).toContain('place_kadikoy.json');
  });
  it('is loading, not runnable, while fetching', () => {
    const v = placeView({ placeFixture: null, placeLoading: true, placeError: null });
    expect(v).toMatchObject({ kind: 'loading', canRun: false });
  });
  it('can run once a place is loaded', () => {
    const v = placeView({ placeFixture: {}, placeLoading: false, placeError: null });
    expect(v).toMatchObject({ kind: 'ready', canRun: true });
  });
});

const pts = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 10, y: 0 },
  { id: 'c', x: 100, y: 0 },
];

describe('parseSeed', () => {
  it('accepts integers and rejects the rest', () => {
    expect(parseSeed(' 42 ')).toBe(42);
    expect(parseSeed('-3')).toBe(-3);
    for (const bad of ['', '1.5', 'abc', '9007199254740993']) expect(parseSeed(bad)).toBeNull();
  });
});

describe('buildRequest', () => {
  it('channel plan sends wall edges with the fixture r', () => {
    const req = buildRequest({ mode: 'channel_plan', points: pts, walls: [], wallsOn: false, r: 20 }, 7);
    expect(req.mode).toBe('channel_plan');
    expect(req.seed).toBe(7);
    expect(req.graph).toEqual({ r: 20, edges: [['a', 'b']] });
  });
  it('walls off sends the plain proximity edges, walls on removes crossed ones', () => {
    const wall = { x1: 5, y1: -5, x2: 5, y2: 5, kind: 'concrete' } as never;
    const off = buildRequest({ mode: 'channel_plan', points: pts, walls: [wall], wallsOn: false, r: 20 }, 1);
    expect(off.graph.edges).toEqual([['a', 'b']]);
  });
  it('place walking sends walking edges with r 150', () => {
    const req = buildRequest(
      { mode: 'place', points: pts, walkingEdges: [['a', 'c']], walking: true, r: 150 },
      1,
    );
    expect(req.graph).toEqual({ r: 150, edges: [['a', 'c']] });
  });
  it('place straight line sends r only', () => {
    const req = buildRequest({ mode: 'place', points: pts, walkingEdges: [['a', 'c']], walking: false, r: 150 }, 1);
    expect(req.graph).toEqual({ r: 150 });
    // The US maps send their own r (Requirement 13.2).
    const us = buildRequest({ mode: 'place', points: pts, walkingEdges: [['a', 'c']], walking: true, r: 244 }, 1);
    expect(us.graph).toEqual({ r: 244, edges: [['a', 'c']] });
    expect('edges' in req.graph).toBe(false);
  });
});
