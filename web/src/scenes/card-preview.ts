// Card_Preview: a small picture of a map's Points and edges (experience spec, Requirement 2.3).
// Edges and Points only (no streets, no walls), one batched path each, drawn from the map's own data.

import { fitView, STATIC_COLOURS, toScreenX, toScreenY } from "../render/static-layer";

export interface PreviewData {
  points: readonly { id: string; x: number; y: number }[];
  edges: readonly (readonly [string, string])[];
  /** Optional box to fit (Your map: the drawing area), so an empty map still has a view. */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

const POINT_COLOUR = "#8f8cb8"; // muted text colour, the same as idle points on the map
const EDGE_COLOUR = STATIC_COLOURS.edgeDrawing;

/** Draw `data` into `canvas` at its CSS size. Returns the number of points drawn. */
export function drawPreview(canvas: HTMLCanvasElement, data: PreviewData, dpr = window.devicePixelRatio || 1): number {
  const w = Math.max(1, Math.round(canvas.clientWidth || Number(canvas.dataset.w) || 280));
  const h = Math.max(1, Math.round(canvas.clientHeight || Number(canvas.dataset.h) || 140));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const view = fitView({ points: data.points, edges: [], bounds: data.bounds }, w, h);
  const at = new Map(data.points.map((p) => [p.id, p]));
  if (data.edges.length > 0) {
    ctx.beginPath();
    for (const [a, b] of data.edges) {
      const pa = at.get(a);
      const pb = at.get(b);
      if (!pa || !pb) continue;
      ctx.moveTo(toScreenX(view, pa.x), toScreenY(view, pa.y));
      ctx.lineTo(toScreenX(view, pb.x), toScreenY(view, pb.y));
    }
    ctx.strokeStyle = EDGE_COLOUR;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Smaller dots on a crowded map, so a few hundred cafes stay readable.
  const r = data.points.length > 150 ? 1.4 : data.points.length > 40 ? 2 : 3;
  ctx.beginPath();
  for (const p of data.points) {
    const x = toScreenX(view, p.x);
    const y = toScreenY(view, p.y);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = POINT_COLOUR;
  ctx.fill();
  return data.points.length;
}
