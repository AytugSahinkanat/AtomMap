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

/**
 * Place_Mode presets. `name` is the fixture's name, `file` is served from fixtures/, `slug` is the
 * map's route and export name, `noun` names its points in plain words. r comes from each fixture.
 */
export const PLACES = [
  { label: 'Kadıköy, Istanbul', name: 'kadikoy', file: 'place_kadikoy.json', slug: 'kadikoy', noun: 'cafés' },
  { label: 'San Francisco bus stops (Mission)', name: 'sf_bus_stops', file: 'place_sf_bus_stops.json', slug: 'sf-bus', noun: 'bus stops' },
  { label: 'New York bike-share stations (Greenwich Village)', name: 'nyc_bike_share', file: 'place_nyc_bike_share.json', slug: 'nyc-bike', noun: 'stations' },
] as const;

/** The preset of a fixture name, or undefined. */
export function placeOf(name: string): (typeof PLACES)[number] | undefined {
  return PLACES.find((p) => p.name === name);
}

/** Display name of a place ("Kadıköy, Istanbul"); the slug itself if unknown. File names keep the ASCII slug. */
export function placeTitle(slug: string): string {
  return PLACES.find((p) => p.name === slug)?.label ?? slug;
}

export type PlaceName = (typeof PLACES)[number]['name'];

/** Kadıköy's walking rule, in metres. Every place reads its own r from its fixture (Requirement 13.2). */
export const PLACE_R_M = 150;

// Your map (ui spec, requirement 8). All values are decided before running (honesty rule 8).

/** The drawing area of Your map, in metres (about the size of the wifi hall). Origin at the lower left. */
export const YOUR_MAP_AREA_M = { width: 90, height: 60 } as const;

/** Conflict radius of Your map: default and allowed range, in metres. */
export const YOUR_R_DEFAULT = 20;
export const YOUR_R_MIN = 2;
export const YOUR_R_MAX = 200;

/** Points added by one press of "Add random points". */
export const RANDOM_BATCH = 10;

/** Press number n (1, 2, ...) of "Add random points" uses the generator RANDOM_SEED_BASE + n. */
export const RANDOM_SEED_BASE = 20260;

/**
 * The starting map: a ring of 8 points on a circle of radius 15 m around the middle of the area.
 * With r = 20 m each point touches only its two neighbours on the ring (11.5 m away), not the next ones (21.2 m).
 * The rules find no safe pick on a ring, so the atoms go first on the very first run.
 */
export const START_RING_POINTS = 8;
export const START_RING_RADIUS_M = 15;

/** Largest text or file the "Points as text" box accepts. */
export const MAX_TEXT_BYTES = 1_000_000;

/**
 * Largest number of points in Your map. Measured, not guessed: the largest size of the measurement plan for which
 * every run, of that size and of all smaller sizes, finished in 60 s or less on the development laptop.
 * The numbers are in web/scripts/limit-measurements.json and in the ui design ("Point limit: result").
 */
export const POINT_LIMIT = 100;

/** Folder the fixtures are served from, relative to the page (same origin). */
export const FIXTURES_DIR = 'fixtures/';
