import { describe, expect, it } from 'vitest';
import { PLACES, placeOf, placeTitle } from './settings';

describe('PLACES', () => {
  it('has Kadıköy and the two US maps, with ASCII names, files and slugs', () => {
    expect(PLACES.map((p) => [p.name, p.file, p.slug])).toEqual([
      ['kadikoy', 'place_kadikoy.json', 'kadikoy'],
      ['sf_bus_stops', 'place_sf_bus_stops.json', 'sf-bus'],
      ['nyc_bike_share', 'place_nyc_bike_share.json', 'nyc-bike'],
    ]);
    for (const p of PLACES) expect(`${p.name}${p.file}${p.slug}`).toMatch(/^[a-z0-9_.-]+$/);
    expect(PLACES[0].label).toBe('Kadıköy, Istanbul');
  });
  it('placeTitle gives the display name, and the slug when unknown', () => {
    expect(placeTitle('kadikoy')).toBe('Kadıköy, Istanbul');
    expect(placeTitle('sf_bus_stops')).toBe('San Francisco bus stops (Mission)');
    expect(placeTitle('elsewhere')).toBe('elsewhere');
    expect(placeOf('nyc_bike_share')?.noun).toBe('stations');
  });
});
