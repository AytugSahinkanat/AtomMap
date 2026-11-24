import { describe, expect, it } from 'vitest';
import { PLACES, placeTitle } from './settings';

describe('PLACES', () => {
  it('has Kadıköy as the only place, with the ASCII slug for files', () => {
    expect(PLACES).toHaveLength(1);
    expect(PLACES[0].name).toBe('kadikoy');
    expect(PLACES[0].file).toBe('place_kadikoy.json');
    expect(PLACES[0].label).toBe('Kadıköy, Istanbul');
  });
  it('placeTitle gives the display name, and the slug when unknown', () => {
    expect(placeTitle('kadikoy')).toBe('Kadıköy, Istanbul');
    expect(placeTitle('elsewhere')).toBe('elsewhere');
  });
});
