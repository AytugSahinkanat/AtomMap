/** True when `active` is `container` or sits inside it. Pure, so it is testable without a DOM. */
export function focusInside(
  container: { contains(other: unknown): boolean } | null,
  active: unknown,
): boolean {
  return container !== null && active !== null && active !== undefined && container.contains(active);
}
