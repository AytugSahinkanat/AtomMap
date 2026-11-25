// The text label of Your map (ui requirement 8.15).

export const YOUR_MAP_LABEL_SUFFIX = "Results are a simulation.";

/** "Your map, N points. Results are a simulation." */
export function yourMapLabel(count: number): string {
  return `Your map, ${count} ${count === 1 ? "point" : "points"}. ${YOUR_MAP_LABEL_SUFFIX}`;
}
