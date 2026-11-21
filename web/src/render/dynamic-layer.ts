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
} from './sprites';

export const Status = {
  Undecided: 0,
  /** Picked by atoms, annealing or coin flip. */
  Picked: 1,
  /** Picked by a classical rule: outlined lock with a "rule" tag. */
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

  private tile: number[] | null = null;
  private focus = -1;
  private reducedMotion = false;
  private dirty = true;

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
    this.tile = null;
    this.focus = -1;
    this.dirty = true;
  }

  /** Clear run state but keep positions. */
  reset(): void {
    this.glow.fill(0);
    this.glowTarget.fill(0);
    this.lockT.fill(0);
    this.fadeT.fill(0);
    this.status.fill(Status.Undecided);
    this.channel.fill(0);
    this.tile = null;
    this.dirty = true;
  }

  /** Glow target for a point (the frequency, 0..1). */
  setGlow(i: number, frequency: number): void {
    const t = Math.min(1, Math.max(0, frequency));
    this.glowTarget[i] = t;
    if (this.reducedMotion) this.glow[i] = t;
    this.dirty = true;
  }

  /** Lock a point on a channel. `rule` draws the outlined lock with a "rule" tag. */
  lock(i: number, channel: number, rule: boolean, animate = true): void {
    this.status[i] = rule ? Status.RulePicked : Status.Picked;
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

    // Glow first so shapes sit on top.
    const size = GLOW_R * 2;
    for (let i = 0; i < this.n; i++) {
      const lvl = glowLevel(this.glow[i]);
      if (lvl < 0 || lvl >= GLOW_LEVELS) continue;
      ctx.drawImage(this.sprites[lvl], this.pos[2 * i] - GLOW_R, this.pos[2 * i + 1] - GLOW_R, size, size);
    }

    for (let i = 0; i < this.n; i++) this.drawPoint(ctx, i);

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
      const pulse = t < 1 ? 1 + 0.4 * Math.sin(Math.PI * t) : 1;
      const r = POINT_R * pulse;
      const path = pathFor(shapeForChannel(ch));
      ctx.scale(r, r);
      if (st === Status.RulePicked) {
        // Outlined (not filled): a rule pick, not a quantum or annealing one.
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.6 / r;
        ctx.stroke(path);
        ctx.restore();
        this.drawRuleTag(ctx, x, y, colour);
        return;
      }
      ctx.fillStyle = colour;
      ctx.fill(path);
    }
    ctx.restore();
  }

  /** Small padlock and the word "rule", so the tag is not colour alone. */
  private drawRuleTag(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
    ctx.save();
    ctx.translate(x + POINT_R + 5, y - POINT_R - 3);
    ctx.scale(4, 4);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1 / 4;
    ctx.stroke(getShapes().lock);
    ctx.restore();
    ctx.save();
    ctx.font = FONT;
    ctx.fillStyle = TEXT_COLOUR;
    ctx.textBaseline = 'top';
    ctx.fillText('rule', x - 8, y + POINT_R + 3);
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
