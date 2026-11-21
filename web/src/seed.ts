// Seed parsing for the typed seed input. Pure functions, no MIS logic.

export type SeedParse =
  | { ok: true; value: number }
  | { ok: false; error: string };

const INTEGER_PATTERN = /^-?\d+$/;

/**
 * Parse typed seed text. The text is trimmed, must match `^-?\d+$` and must be
 * a safe integer. Otherwise the result carries a plain-words message.
 */
export function parseSeed(text: string): SeedParse {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, error: "Type a whole number for the seed." };
  }
  if (!INTEGER_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: "The seed must be a whole number, like 7 or -3.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: "That seed number is too large. Use a smaller one." };
  }
  // Normalise -0 to 0.
  return { ok: true, value: value === 0 ? 0 : value };
}

/** Seed for "Run again with another seed": the previous seed plus 1. */
export function nextSeed(prev: number): number {
  return prev + 1;
}
