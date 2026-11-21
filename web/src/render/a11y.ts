// Accessibility layer for the canvas map (design: Accessibility).
// A visually hidden list mirrors the Points in id order with one roving
// tabindex. Arrow keys move to the nearest Point in that direction on screen.
// The dynamic canvas reads the focused id through `onFocusChange` and draws
// the focus ring. All text is set with textContent.

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface ScreenPoint {
  id: string;
  /** Position in CSS pixels on screen (y grows downwards). */
  x: number;
  y: number;
}

/**
 * Nearest Point from `from` in a direction on screen.
 * First choice: Points inside a 90 degree cone around the direction, nearest
 * by distance. Fallback: any Point strictly ahead, scored by distance along
 * the axis plus twice the sideways offset. Returns null when none is ahead.
 */
export function nearestInDirection(
  points: readonly ScreenPoint[],
  from: ScreenPoint,
  dir: Direction,
): ScreenPoint | null {
  let bestCone: ScreenPoint | null = null;
  let bestConeD = Infinity;
  let bestAhead: ScreenPoint | null = null;
  let bestAheadScore = Infinity;

  for (const p of points) {
    if (p.id === from.id) continue;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    if (side <= along) {
      const d = dx * dx + dy * dy;
      if (d < bestConeD || (d === bestConeD && bestCone !== null && p.id < bestCone.id)) {
        bestConeD = d;
        bestCone = p;
      }
    }
    const score = along + 2 * side;
    if (score < bestAheadScore) {
      bestAheadScore = score;
      bestAhead = p;
    }
  }
  return bestCone ?? bestAhead;
}

const KEY_DIRECTION: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: '0',
};

export interface A11yOptions {
  /** Called with the focused Point id, or null when focus leaves the list. */
  onFocusChange?: (id: string | null) => void;
}

export interface A11yLayer {
  /** Set the Points (any order; the list is sorted by id) and screen positions. */
  setPoints(points: readonly ScreenPoint[]): void;
  /** Update screen positions only (resize, zoom). Ids must match the current Points. */
  setPositions(points: readonly ScreenPoint[]): void;
  /** Set the text of one Point, e.g. "ap12, picked on channel 6". */
  setPointText(id: string, text: string): void;
  /** Set the aria-label of the map container: map name, Point count, mode. */
  setMapLabel(name: string, pointCount: number, mode: string): void;
  /** Announce a Round or run change in the single polite live region. */
  announce(message: string): void;
  /** Id of the Point holding the roving tabindex, or null. */
  readonly activeId: string | null;
  /** Id of the Point that has keyboard focus, or null. */
  readonly focusedId: string | null;
  destroy(): void;
}

export function createA11y(container: HTMLElement, options: A11yOptions = {}): A11yLayer {
  const doc = container.ownerDocument;

  const list = doc.createElement('ul');
  Object.assign(list.style, VISUALLY_HIDDEN);
  list.setAttribute('aria-label', 'Points');

  const live = doc.createElement('div');
  Object.assign(live.style, VISUALLY_HIDDEN);
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  live.setAttribute('role', 'status');

  container.setAttribute('role', 'group');
  container.append(list, live);

  let points: ScreenPoint[] = [];
  const items = new Map<string, HTMLLIElement>();
  let activeId: string | null = null;
  let focusedId: string | null = null;

  function setActive(id: string | null): void {
    if (activeId !== null) items.get(activeId)?.setAttribute('tabindex', '-1');
    activeId = id;
    if (id !== null) items.get(id)?.setAttribute('tabindex', '0');
  }

  function setFocused(id: string | null): void {
    if (focusedId === id) return;
    focusedId = id;
    options.onFocusChange?.(id);
  }

  function onKeyDown(e: KeyboardEvent): void {
    const dir = KEY_DIRECTION[e.key];
    if (!dir || activeId === null) return;
    const from = points.find((p) => p.id === activeId);
    if (!from) return;
    e.preventDefault();
    const next = nearestInDirection(points, from, dir);
    if (next) items.get(next.id)?.focus();
  }

  function onFocusIn(e: FocusEvent): void {
    const li = (e.target as HTMLElement).closest('li');
    const id = li?.dataset.id;
    if (id === undefined) return;
    setActive(id);
    setFocused(id);
  }

  function onFocusOut(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null;
    if (to && list.contains(to)) return; // moving inside the list
    setFocused(null);
  }

  list.addEventListener('keydown', onKeyDown);
  list.addEventListener('focusin', onFocusIn);
  list.addEventListener('focusout', onFocusOut);

  return {
    setPoints(next) {
      const keepActive = activeId;
      points = [...next].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const oldText = new Map<string, string>();
      for (const [id, li] of items) oldText.set(id, li.textContent ?? '');
      items.clear();
      activeId = null;
      list.replaceChildren();
      for (const p of points) {
        const li = doc.createElement('li');
        li.dataset.id = p.id;
        li.setAttribute('tabindex', '-1');
        li.textContent = oldText.get(p.id) ?? p.id;
        items.set(p.id, li);
        list.append(li);
      }
      if (focusedId !== null && !items.has(focusedId)) setFocused(null);
      const first = points[0]?.id ?? null;
      setActive(keepActive !== null && items.has(keepActive) ? keepActive : first);
    },
    setPositions(next) {
      const pos = new Map(next.map((p) => [p.id, p]));
      points = points.map((p) => pos.get(p.id) ?? p);
    },
    setPointText(id, text) {
      const li = items.get(id);
      if (li) li.textContent = text;
    },
    setMapLabel(name, pointCount, mode) {
      const noun = pointCount === 1 ? 'point' : 'points';
      container.setAttribute('aria-label', `${name}, ${pointCount} ${noun}, ${mode} mode`);
    },
    announce(message) {
      live.textContent = message;
    },
    get activeId() {
      return activeId;
    },
    get focusedId() {
      return focusedId;
    },
    destroy() {
      list.removeEventListener('keydown', onKeyDown);
      list.removeEventListener('focusin', onFocusIn);
      list.removeEventListener('focusout', onFocusOut);
      list.remove();
      live.remove();
      container.removeAttribute('aria-label');
      container.removeAttribute('role');
    },
  };
}
