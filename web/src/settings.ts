// Constants only. No logic. Values are decided before running (honesty rule 8).

/** Default seed, fixed in advance. */
export const DEFAULT_SEED = 1;

/** Speed control steps, in progress events per second. */
export const SPEED_STEPS: readonly number[] = [2, 5, 10, 25, 60];

/** Default speed, one of SPEED_STEPS. */
export const DEFAULT_SPEED = 10;

// Radio_Model:
// Received power dBm = 10 - 40 - 30*log10(d) - wall losses
// Pt 10 dBm, path loss at 1 m 40 dB, exponent 3.
export const TX_POWER_DBM = 10;
export const PATH_LOSS_1M_DB = 40;
export const PATH_LOSS_EXPONENT = 3;

/** Signal_Threshold in dBm. Open-air range is about 20 m. */
export const SIGNAL_THRESHOLD_DBM = -69;

/** Wall losses in dB. */
export const WALL_LOSS_DB = {
  concrete: 12,
  drywall: 4,
} as const;

/** Accent colour, used for focus rings. */
export const ACCENT_COLOUR = '#7f77dd';
