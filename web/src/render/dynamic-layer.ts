// Dynamic canvas layer: points, glow, lock-in pulse, fading neighbours, tile
// outline and focus ring. Draws only; it holds no MIS logic. State lives in
// typed arrays. Glow uses pre-rendered sprites (no shadowBlur, no per-frame gradients).

import { ACCENT_COLOUR } from '../settings';
import {
  GLOW_LEVELS,
  GREY_COLOUR,
  TEXT_COLOUR,
  colourForChannel,
  createGlowSprites,
  getShapes,
  glowLevel,
  pathFor,
  shapeForChannel,
  TEAL_COLOUR,
} from './sprites';
import type { AtomsView } from './shot-replay';

/** Clash marks of the hand pick: red with a cross or a dash, so they are not colour alone. */
export const CLASH_COLOUR = '#ff6b6b';
const HALO_COLOUR = 'rgba(93, 202, 165, 0.55)';
const SWEEP_COLOUR = 'rgba(127, 119, 221, 0.16)';
const SWEEP_EDGE = 'rgba(127, 119, 221, 0.75)';
const PAIR_COLOUR = 'rgba(127, 119, 221, 0.7)';

export const Status = {
  Undecided: 0,
  /** Picked by the atoms (filled). */
  Picked: 1,
  /** Picked classically (rule, annealing, coin flip): outlined lock with a "classical" tag. */
  RulePicked: 2,
  /** Removed neighbour, fading out. */
  Removed: 3,
  /** Left out of every round (5 GHz only), hollow grey circle. */
  FiveGhzOnly: 4,
} as const;
export type StatusCode = (typeof Status)[keyof typeof Status];

const TWEEN_MS = 300;
const POINT_R = 4.5;
const GLOW_R = 16;
const FONT = '500 10px system-ui, -apple-system, "Segoe UI", sans-serif';

export class DynamicLayer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private sprites: HTMLCanvasElement[] = [];

  private n = 0;
  private pos = new Float32Array(0); // x0,y0,x1,y1,... in CSS pixels
  /** Current glow 0..1 (eases to glowTarget). */
  glow = new Float32Array(0);
  /** Lock pulse progress 0..1; below 1 the point is pulsing. */
  lockT = new Float32Array(0);
  /** Fade progress 0..1 for removed points. */
  fadeT = new Float32Array(0);
  status = new Uint8Array(0);
  private glowTarget = new Float32Array(0);
  private channel = new Uint8Array(0);
  /** 1 = classical pick that is not a rule (annealing fallback, coin flip): tag word "classical". */
  private classical = new Uint8Array(0);

  private tile: number[] | null = null;
  private focus = -1;
  private ring: number[] = [];
  private gaps: number[] = [];
  private reducedMotion = false;
  private finalView = false;
  private dirty = true;

  /** The Group on the atoms (experience spec, Requirement 7), drawn from real events only. */
  private atoms: {
    group: readonly number[];
    flash: readonly number[];
    sweep: number | null;
    haloPx: number | null;
    pairs: [number, number][];
  } | null = null;

  /** The visitor's hand pick (experience spec, Requirement 9). */
  private hand: { picked: Set<number>; clash: Set<number>; clashEdges: [number, number][] } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
  }

  /** Set once per size or pixel ratio change. Rebuilds the sprites. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.sprites = createGlowSprites(GLOW_R, dpr);
    this.dirty = true;
  }

  /** With reduced motion there are no pulses, glow transitions or fades. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.dirty = true;
  }

  /** New map: screen positions as x,y pairs in CSS pixels. Resets all state. */
  setPoints(xy: ArrayLike<number>): void {
    const n = Math.floor(xy.length / 2);
    this.n = n;
    this.pos = Float32Array.from(xy as ArrayLike<number>);
    this.glow = new Float32Array(n);
    this.lockT = new Float32Array(n);
    this.fadeT = new Float32Array(n);
    this.status = new Uint8Array(n);
    this.glowTarget = new Float32Array(n);
    this.channel = new Uint8Array(n);
    this.classical = new Uint8Array(n);
    this.tile = null;
    this.focus = -1;
    this.ring = [];
    this.gaps = [];
    this.atoms = null;
    this.hand = null;
    this.dirty = true;
  }

  /**
   * Final map: the "rule" text label is dropped (the legend explains the
   * outlined padlock glyph instead). During playback the label stays.
   */
  setFinalView(on: boolean): void {
    if (this.finalView === on) return;
    this.finalView = on;
    this.dirty = true;
  }

  /** Clear run state but keep positions. */
  reset(): void {
    this.finalView = false;
    this.glow.fill(0);
    this.glowTarget.fill(0);
    this.lockT.fill(0);
    this.fadeT.fill(0);
    this.status.fill(Status.Undecided);
    this.channel.fill(0);
    this.classical.fill(0);
    this.tile = null;
    this.gaps = [];
    this.atoms = null;
    this.dirty = true;
  }

  /** Points a plan left uncovered (atoms alone): dashed ring, no animation. An empty list clears it. */
  setGaps(indices: readonly number[]): void {
    const next = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < this.n);
    if (next.length === 0 && this.gaps.length === 0) return;
    this.gaps = next;
    this.dirty = true;
  }

  /** Glow target for a point (the frequency, 0..1). */
  setGlow(i: number, frequency: number): void {
    const t = Math.min(1, Math.max(0, frequency));
    this.glowTarget[i] = t;
    if (this.reducedMotion) this.glow[i] = t;
    this.dirty = true;
  }

  /** Lock a point on a channel. `rule` draws the outlined lock with a tag: "rule", or "classical" when `classical` is set (annealing fallback, coin flip). */
  lock(i: number, channel: number, rule: boolean, animate = true, classical = false): void {
    this.status[i] = rule ? Status.RulePicked : Status.Picked;
    this.classical[i] = rule && classical ? 1 : 0;
    this.channel[i] = channel;
    this.lockT[i] = animate && !this.reducedMotion ? 0 : 1;
    this.glowTarget[i] = 0;
    this.glow[i] = animate && !this.reducedMotion ? this.glow[i] : 0;
    this.dirty = true;
  }

  /** A neighbour removed by a pick. */
  remove(i: number, animate = true): void {
    if (this.status[i] === Status.Picked || this.status[i] === Status.RulePicked) return;
    this.status[i] = Status.Removed;
    this.glowTarget[i] = 0;
    this.fadeT[i] = animate && !this.reducedMotion ? 0 : 1;
    this.dirty = true;
  }

  /** Point not picked in any round: hollow grey circle. */
  setFiveGhzOnly(i: number): void {
    this.status[i] = Status.FiveGhzOnly;
    this.channel[i] = 5;
    this.glow[i] = 0;
    this.glowTarget[i] = 0;
    this.dirty = true;
  }

  /** Dashed stitch outline around a tile's points, or null to hide it. */
  setTile(indices: number[] | null): void {
    this.tile = indices && indices.length ? indices.slice() : null;
    this.dirty = true;
  }

  /** Focus ring for the point focused in the accessibility list. -1 clears it. */
  setFocus(i: number): void {
    this.focus = i;
    this.dirty = true;
  }

  /** Tutor ring: accent-coloured rings around the given points, no animation. An empty list clears it. */
  setRing(indices: readonly number[]): void {
    const next = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < this.n);
    if (next.length === 0 && this.ring.length === 0) return;
    this.ring = next;
    this.dirty = true;
  }

  /**
   * The Group on the atoms now, or null. `haloPx`: the Blockade_Halo radius (r/2 on screen), or
   * null when the map's edges do not follow straight-line distance (then the real blockade pairs
   * are drawn instead, so no halo says something the atoms do not do). `edges`: all edges of the
   * map as index pairs; only the pairs inside the Group are drawn.
   */
  setAtoms(view: AtomsView | null, haloPx: number | null, edges: readonly (readonly [number, number])[]): void {
    if (view === null) {
      if (this.atoms !== null) this.dirty = true;
      this.atoms = null;
      return;
    }
    const inGroup = new Set(view.group);
    const pairs: [number, number][] = [];
    for (const [a, b] of edges) if (inGroup.has(a) && inGroup.has(b)) pairs.push([a, b]);
    this.atoms = {
      group: view.group.filter((i) => i >= 0 && i < this.n),
      flash: this.reducedMotion ? view.flash.map(() => 0) : view.flash,
      sweep: this.reducedMotion ? null : view.sweep,
      haloPx,
      pairs,
    };
    this.dirty = true;
  }

  /** The hand pick: picked points, the points in a clash, and the clash edges (index pairs). Null hides it. */
  setHandPick(picked: readonly number[] | null, clash: readonly number[] = [], clashEdges: readonly (readonly [number, number])[] = []): void {
    this.hand = picked === null ? null : {
      picked: new Set(picked),
      clash: new Set(clash),
      clashEdges: clashEdges.map(([a, b]) => [a, b] as [number, number]),
    };
    this.dirty = true;
  }

  /** Jump every tween to its end (skip, reduced motion, plan switch). */
  finishTweens(): void {
    for (let i = 0; i < this.n; i++) {
      this.glow[i] = this.glowTarget[i];
      if (this.lockT[i] < 1) this.lockT[i] = 1;
      if (this.status[i] === Status.Removed) this.fadeT[i] = 1;
    }
    this.dirty = true;
  }

  /** True while any tween still moves. The rAF loop uses this to know when it can stop. */
  isAnimating(): boolean {
    for (let i = 0; i < this.n; i++) {
      if (this.glow[i] !== this.glowTarget[i]) return true;
      if (this.status[i] !== Status.Undecided && this.lockT[i] < 1 && this.status[i] !== Status.Removed) return true;
      if (this.status[i] === Status.Removed && this.fadeT[i] < 1) return true;
    }
    return false;
  }

  /** Advance tweens by dtMs. Returns true if something changed. */
  tick(dtMs: number): boolean {
    if (this.reducedMotion) {
      this.finishTweens();
      return this.consumeDirty();
    }
    const step = dtMs / TWEEN_MS;
    for (let i = 0; i < this.n; i++) {
      const g = this.glow[i];
      const t = this.glowTarget[i];
      if (g !== t) {
        this.glow[i] = g < t ? Math.min(t, g + step) : Math.max(t, g - step);
        this.dirty = true;
      }
      if (this.lockT[i] < 1) {
        this.lockT[i] = Math.min(1, this.lockT[i] + step);
        this.dirty = true;
      }
      if (this.status[i] === Status.Removed && this.fadeT[i] < 1) {
        this.fadeT[i] = Math.min(1, this.fadeT[i] + step);
        this.dirty = true;
      }
    }
    return this.dirty;
  }

  private consumeDirty(): boolean {
    return this.dirty;
  }

  /** Draw once if anything changed. Call at most once per frame. */
  draw(force = false): void {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (this.tile) this.drawTile(ctx);
    if (this.atoms) this.drawAtomsUnder(ctx);
    if (this.hand) this.drawClashEdges(ctx);

    // Glow first so shapes sit on top.
    const size = GLOW_R * 2;
    for (let i = 0; i < this.n; i++) {
      const lvl = glowLevel(this.glow[i]);
      if (lvl < 0 || lvl >= GLOW_LEVELS) continue;
      ctx.drawImage(this.sprites[lvl], this.pos[2 * i] - GLOW_R, this.pos[2 * i + 1] - GLOW_R, size, size);
    }

    for (let i = 0; i < this.n; i++) this.drawPoint(ctx, i);
    if (this.atoms) this.drawAtomsOver(ctx);
    if (this.hand) this.drawHandMarks(ctx);

    if (this.gaps.length) {
      ctx.strokeStyle = TEXT_COLOUR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      for (const i of this.gaps) {
        ctx.beginPath();
        ctx.arc(this.pos[2 * i], this.pos[2 * i + 1], POINT_R + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (this.ring.length) {
      ctx.strokeStyle = ACCENT_COLOUR;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      for (const i of this.ring) {
        if (i >= this.n) continue;
        ctx.beginPath();
        ctx.arc(this.pos[2 * i], this.pos[2 * i + 1], POINT_R + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (this.focus >= 0 && this.focus < this.n) {
      ctx.strokeStyle = ACCENT_COLOUR;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(this.pos[2 * this.focus], this.pos[2 * this.focus + 1], POINT_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPoint(ctx: CanvasRenderingContext2D, i: number): void {
    const x = this.pos[2 * i];
    const y = this.pos[2 * i + 1];
    const st = this.status[i];
    ctx.save();
    ctx.translate(x, y);

    if (st === Status.Undecided) {
      ctx.fillStyle = GREY_COLOUR;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, POINT_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (st === Status.Removed) {
      ctx.fillStyle = GREY_COLOUR;
      ctx.globalAlpha = 0.8 - 0.65 * this.fadeT[i];
      ctx.beginPath();
      ctx.arc(0, 0, POINT_R * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (st === Status.FiveGhzOnly) {
      ctx.strokeStyle = GREY_COLOUR;
      ctx.lineWidth = 1.5;
      ctx.scale(POINT_R, POINT_R);
      ctx.lineWidth = 1.5 / POINT_R;
      ctx.stroke(pathFor('hollow'));
    } else {
      const ch = this.channel[i];
      const colour = colourForChannel(ch);
      const t = this.lockT[i];
      // An atom pick collapses from the atom's size into the locked shape; a rule pick keeps the short pulse.
      const pulse = t >= 1 ? 1 : st === Status.Picked ? 1 + 0.6 * (1 - t) * (1 - t) : 1 + 0.4 * Math.sin(Math.PI * t);
      const r = POINT_R * pulse;
      const path = pathFor(shapeForChannel(ch));
      ctx.scale(r, r);
      if (st === Status.RulePicked) {
        // Outlined (not filled): a classical pick, not an atoms pick.
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.6 / r;
        ctx.stroke(path);
        ctx.restore();
        this.drawRuleTag(ctx, x, y, colour, this.classical[i] === 1 ? 'classical' : 'rule');
        return;
      }
      ctx.fillStyle = colour;
      ctx.fill(path);
    }
    ctx.restore();
  }

  /** Small padlock and the tag word ("rule" or "classical"), so the tag is not colour alone. */
  private drawRuleTag(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string, word: string): void {
    ctx.save();
    ctx.translate(x + POINT_R + 5, y - POINT_R - 3);
    ctx.scale(4, 4);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1 / 4;
    ctx.stroke(getShapes().lock);
    ctx.restore();
    if (this.finalView) return;
    ctx.save();
    ctx.font = FONT;
    ctx.fillStyle = TEXT_COLOUR;
    ctx.textBaseline = 'top';
    ctx.fillText(word, x - 12, y + POINT_R + 3);
    ctx.restore();
  }

  private groupBox(): [number, number, number, number] | null {
    if (!this.atoms) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of this.atoms.group) {
      const x = this.pos[2 * i];
      const y = this.pos[2 * i + 1];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return x0 === Infinity ? null : [x0, y0, x1, y1];
  }

  /** Under the points: the laser sweep, the Blockade_Halos (or the blockade pairs). */
  private drawAtomsUnder(ctx: CanvasRenderingContext2D): void {
    const a = this.atoms!;
    const box = this.groupBox();
    if (!box) return;
    const [x0, y0, x1, y1] = box;
    ctx.save();
    if (a.sweep !== null) {
      // A band of light moving left to right over the Group while it is simulated.
      const pad = 18;
      const w = Math.max(24, (x1 - x0 + 2 * pad) * 0.18);
      const span = x1 - x0 + 2 * pad + w;
      const left = x0 - pad - w + span * a.sweep;
      ctx.beginPath();
      ctx.rect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
      ctx.clip();
      ctx.fillStyle = SWEEP_COLOUR;
      ctx.fillRect(left, y0 - pad, w, y1 - y0 + 2 * pad);
      ctx.fillStyle = SWEEP_EDGE;
      ctx.fillRect(left + w - 1.5, y0 - pad, 1.5, y1 - y0 + 2 * pad);
      ctx.restore();
      ctx.save();
    }
    if (a.haloPx !== null && a.haloPx > 0) {
      // Two halos that overlap are two points closer than r: they cannot both light up.
      ctx.strokeStyle = HALO_COLOUR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const i of a.group) {
        ctx.beginPath();
        ctx.arc(this.pos[2 * i], this.pos[2 * i + 1], a.haloPx, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (a.pairs.length) {
      // Walls or walking distance: the real blockade pairs of the Group, not a circle.
      ctx.strokeStyle = PAIR_COLOUR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const [p, q] of a.pairs) {
        ctx.moveTo(this.pos[2 * p], this.pos[2 * p + 1]);
        ctx.lineTo(this.pos[2 * q], this.pos[2 * q + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Over the points: each atom of the Group as a sphere, and its flash when a shot kept it. */
  private drawAtomsOver(ctx: CanvasRenderingContext2D): void {
    const a = this.atoms!;
    ctx.save();
    a.group.forEach((i, k) => {
      if (this.status[i] !== Status.Undecided) return;
      const x = this.pos[2 * i];
      const y = this.pos[2 * i + 1];
      const f = a.flash[k] ?? 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = TEAL_COLOUR;
      ctx.beginPath();
      ctx.arc(x, y, POINT_R * 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = TEXT_COLOUR;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, POINT_R * 1.15 + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      if (f > 0) {
        ctx.globalAlpha = 0.85 * f;
        ctx.fillStyle = TEXT_COLOUR;
        ctx.beginPath();
        ctx.arc(x, y, POINT_R * (1.2 + 0.6 * f), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  /** The edges between two picked points of the hand pick: red and dashed. */
  private drawClashEdges(ctx: CanvasRenderingContext2D): void {
    const h = this.hand!;
    if (!h.clashEdges.length) return;
    ctx.save();
    ctx.strokeStyle = CLASH_COLOUR;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    for (const [p, q] of h.clashEdges) {
      ctx.moveTo(this.pos[2 * p], this.pos[2 * p + 1]);
      ctx.lineTo(this.pos[2 * q], this.pos[2 * q + 1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** A picked point: a filled accent diamond. In a clash: a red diamond with a cross. */
  private drawHandMarks(ctx: CanvasRenderingContext2D): void {
    const h = this.hand!;
    ctx.save();
    for (const i of h.picked) {
      if (i < 0 || i >= this.n) continue;
      const x = this.pos[2 * i];
      const y = this.pos[2 * i + 1];
      const r = POINT_R * 1.5;
      const clash = h.clash.has(i);
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = clash ? CLASH_COLOUR : ACCENT_COLOUR;
      ctx.fill();
      ctx.strokeStyle = TEXT_COLOUR;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (clash) {
        ctx.strokeStyle = TEXT_COLOUR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.4, y - r * 0.4);
        ctx.lineTo(x + r * 0.4, y + r * 0.4);
        ctx.moveTo(x + r * 0.4, y - r * 0.4);
        ctx.lineTo(x - r * 0.4, y + r * 0.4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawTile(ctx: CanvasRenderingContext2D): void {
    if (!this.tile) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of this.tile) {
      if (i < 0 || i >= this.n) continue;
      const x = this.pos[2 * i];
      const y = this.pos[2 * i + 1];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (x0 === Infinity) return;
    const pad = 12;
    ctx.save();
    ctx.strokeStyle = TEXT_COLOUR;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.roundRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, 8);
    ctx.stroke();
    ctx.restore();
  }
}
