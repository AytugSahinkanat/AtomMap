// Constants, plus the one radio formula that defines the threshold. Values are decided before running (honesty rule 8).

/** Default seed, fixed in advance. */
export const DEFAULT_SEED = 1;

/** Speed control steps, in progress events per second. */
export const SPEED_STEPS: readonly number[] = [2, 5, 10, 25, 60];

/** Default speed, one of SPEED_STEPS. */
export const DEFAULT_SPEED = 25;

// Radio_Model:
// Received power dBm = 10 - 40 - 30*log10(d) - wall losses
// Pt 10 dBm, path loss at 1 m 40 dB, exponent 3.
export const TX_POWER_DBM = 10;
export const PATH_LOSS_1M_DB = 40;
export const PATH_LOSS_EXPONENT = 3;

/** Open-air received power at distance d metres (no wall losses). */
export function receivedPowerDbm(d: number): number {
  return (
    TX_POWER_DBM - PATH_LOSS_1M_DB - 10 * PATH_LOSS_EXPONENT * Math.log10(d)
  );
}

/**
 * Signal_Threshold in dBm: the received power at distance r metres, where r is
 * read from the Hero_Map fixture (for example r = 20 gives about -69.03 dBm).
 * An edge needs power strictly above it, so walls off gives the r-graph.
 */
export function signalThresholdDbm(r: number): number {
  return receivedPowerDbm(r);
}

/** Wall losses in dB. */
export const WALL_LOSS_DB = {
  concrete: 12,
  drywall: 4,
} as const;

/** Accent colour, used for focus rings. */
export const ACCENT_COLOUR = '#7f77dd';

/** Place_Mode presets. `name` is the file suffix, `file` is served from fixtures/. */
export const PLACES = [
  { label: 'Kadıköy, Istanbul', name: 'kadikoy', file: 'place_kadikoy.json' },
] as const;

/** Display name of a place ("Kadıköy, Istanbul"); the slug itself if unknown. File names keep the ASCII slug. */
export function placeTitle(slug: string): string {
  return PLACES.find((p) => p.name === slug)?.label ?? slug;
}

export type PlaceName = (typeof PLACES)[number]['name'];

/** Walking rule for Place_Mode, in metres. */
export const PLACE_R_M = 150;

/** Folder the fixtures are served from, relative to the page (same origin). */
export const FIXTURES_DIR = 'fixtures/';
