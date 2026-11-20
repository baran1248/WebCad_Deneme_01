import { STANDARD_PLANES } from '../data/defaultProject';
import {
  PlaneDefinition,
  PlaneId,
  SketchConstraint,
  SketchData,
  SketchEntity,
} from '../types/cad';

export function resolvePlane(
  planeId: PlaneId,
  offset = 0,
  customPlane?: PlaneDefinition
): PlaneDefinition {
  const base: PlaneDefinition =
    customPlane ??
    (planeId === 'front' || planeId === 'top' || planeId === 'right'
      ? STANDARD_PLANES[planeId]
      : STANDARD_PLANES.front);

  if (!offset) return base;
  return {
    ...base,
    origin: [
      base.origin[0] + base.normal[0] * offset,
      base.origin[1] + base.normal[1] * offset,
      base.origin[2] + base.normal[2] * offset,
    ],
  };
}

export function sketch2DTo3D(
  u: number,
  v: number,
  plane: PlaneDefinition
): [number, number, number] {
  return [
    plane.origin[0] + plane.uAxis[0] * u + plane.vAxis[0] * v,
    plane.origin[1] + plane.uAxis[1] * u + plane.vAxis[1] * v,
    plane.origin[2] + plane.uAxis[2] * u + plane.vAxis[2] * v,
  ];
}

export function world3DToSketch2D(
  p: [number, number, number],
  plane: PlaneDefinition
): [number, number] {
  const dx = p[0] - plane.origin[0];
  const dy = p[1] - plane.origin[1];
  const dz = p[2] - plane.origin[2];
  const u = dx * plane.uAxis[0] + dy * plane.uAxis[1] + dz * plane.uAxis[2];
  const v = dx * plane.vAxis[0] + dy * plane.vAxis[1] + dz * plane.vAxis[2];
  return [u, v];
}

function getPoint(
  entity: SketchEntity,
  which: 'start' | 'end' | 'center'
): [number, number] {
  if (entity.type === 'line' || entity.type === 'slot') {
    if (which === 'start') return [entity.x1, entity.y1];
    if (which === 'end') return [entity.x2, entity.y2];
    return [(entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2];
  }
  if (entity.type === 'rect') {
    if (which === 'start') return [entity.x, entity.y];
    if (which === 'end') return [entity.x + entity.width, entity.y + entity.height];
    return [entity.x + entity.width / 2, entity.y + entity.height / 2];
  }
  if (entity.type === 'circle' || entity.type === 'polygon') {
    return [entity.cx, entity.cy];
  }
  if (entity.type === 'spline') {
    const pts = entity.points;
    if (pts.length === 0) return [0, 0];
    if (which === 'start') return pts[0];
    if (which === 'end') return pts[pts.length - 1];
    const mid = pts[Math.floor(pts.length / 2)];
    return mid;
  }
  // arc
  if (which === 'start') {
    return [
      entity.cx + entity.radius * Math.cos(entity.startAngle),
      entity.cy + entity.radius * Math.sin(entity.startAngle),
    ];
  }
  if (which === 'end') {
    return [
      entity.cx + entity.radius * Math.cos(entity.endAngle),
      entity.cy + entity.radius * Math.sin(entity.endAngle),
    ];
  }
  return [entity.cx, entity.cy];
}

function setLinePoint(
  entity: SketchEntity,
  which: 'start' | 'end' | 'center',
  x: number,
  y: number
) {
  if (entity.type === 'line' || entity.type === 'slot') {
    if (which === 'start') {
      entity.x1 = x;
      entity.y1 = y;
    } else if (which === 'end') {
      entity.x2 = x;
      entity.y2 = y;
    }
  } else if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'polygon') {
    if (which === 'center') {
      entity.cx = x;
      entity.cy = y;
    }
  }
}

/**
 * Iterative 2D geometric constraint solver supporting SolidWorks relations:
 * Horizontal, Vertical, Coincident, Parallel, Perpendicular, Tangent, Equal, and Smart Dimension.
 */
export function solveSketchConstraints(
  entitiesInput: SketchEntity[],
  constraints: SketchConstraint[],
  iterations = 24
): SketchEntity[] {
  const entities: SketchEntity[] = entitiesInput.map((e) =>
    e.type === 'spline'
      ? { ...e, points: e.points.map((pt) => [pt[0], pt[1]] as [number, number]) }
      : { ...e }
  );
  const byId = new Map<string, SketchEntity>();
  for (const e of entities) byId.set(e.id, e);

  const dims = constraints.filter((c) => c.type === 'dimension');
  const coincs = constraints.filter((c) => c.type === 'coincident');
  const aligns = constraints.filter(
    (c) => c.type === 'horizontal' || c.type === 'vertical'
  );
  const pairwise = constraints.filter(
    (c) =>
      c.type === 'parallel' ||
      c.type === 'perpendicular' ||
      c.type === 'tangent' ||
      c.type === 'equal'
  );

  for (let iter = 0; iter < iterations; iter++) {
    for (const c of dims) {
      if (c.type !== 'dimension' || c.value <= 0) continue;
      const ent = byId.get(c.entityId);
      if (!ent) continue;
      if (ent.type === 'line' && c.param === 'length') {
        const dx = ent.x2 - ent.x1;
        const dy = ent.y2 - ent.y1;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          const scale = c.value / len;
          ent.x2 = ent.x1 + dx * scale;
          ent.y2 = ent.y1 + dy * scale;
        }
      } else if (ent.type === 'rect') {
        if (c.param === 'width') ent.width = c.value;
        if (c.param === 'height') ent.height = c.value;
      } else if (
        ent.type === 'circle' ||
        ent.type === 'arc' ||
        ent.type === 'polygon' ||
        ent.type === 'slot'
      ) {
        if (c.param === 'radius') ent.radius = c.value;
        if (c.param === 'diameter') ent.radius = c.value / 2;
      }
    }

    for (const c of pairwise) {
      if (
        c.type !== 'parallel' &&
        c.type !== 'perpendicular' &&
        c.type !== 'tangent' &&
        c.type !== 'equal'
      ) {
        continue;
      }
      const a = byId.get(c.entityAId);
      const b = byId.get(c.entityBId);
      if (!a || !b) continue;

      if (c.type === 'equal') {
        if (a.type === 'line' && b.type === 'line') {
          const la = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
          const lb = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
          if (la > 1e-6 && lb > 1e-6) {
            const scale = la / lb;
            b.x2 = b.x1 + (b.x2 - b.x1) * scale;
            b.y2 = b.y1 + (b.y2 - b.y1) * scale;
          }
        } else if (
          (a.type === 'circle' || a.type === 'arc' || a.type === 'polygon') &&
          (b.type === 'circle' || b.type === 'arc' || b.type === 'polygon')
        ) {
          b.radius = a.radius;
        }
      } else if (c.type === 'parallel' && a.type === 'line' && b.type === 'line') {
        const ux = a.x2 - a.x1;
        const uy = a.y2 - a.y1;
        const la = Math.hypot(ux, uy);
        const vx = b.x2 - b.x1;
        const vy = b.y2 - b.y1;
        const lb = Math.hypot(vx, vy);
        if (la > 1e-6 && lb > 1e-6) {
          const dotSign = ux * vx + uy * vy >= 0 ? 1 : -1;
          b.x2 = b.x1 + (ux / la) * lb * dotSign;
          b.y2 = b.y1 + (uy / la) * lb * dotSign;
        }
      } else if (c.type === 'perpendicular' && a.type === 'line' && b.type === 'line') {
        const ux = a.x2 - a.x1;
        const uy = a.y2 - a.y1;
        const la = Math.hypot(ux, uy);
        const vx = b.x2 - b.x1;
        const vy = b.y2 - b.y1;
        const lb = Math.hypot(vx, vy);
        if (la > 1e-6 && lb > 1e-6) {
          const px = -uy / la;
          const py = ux / la;
          const sign = px * vx + py * vy >= 0 ? 1 : -1;
          b.x2 = b.x1 + px * lb * sign;
          b.y2 = b.y1 + py * lb * sign;
        }
      } else if (c.type === 'tangent') {
        const circ = a.type === 'circle' ? a : b.type === 'circle' ? b : null;
        const ln = a.type === 'line' ? a : b.type === 'line' ? b : null;
        if (circ && ln) {
          const dx = ln.x2 - ln.x1;
          const dy = ln.y2 - ln.y1;
          const len = Math.hypot(dx, dy);
          if (len > 1e-6) {
            const nx = -dy / len;
            const ny = dx / len;
            const signedDist = (circ.cx - ln.x1) * nx + (circ.cy - ln.y1) * ny;
            const sign = signedDist >= 0 ? 1 : -1;
            const shift = sign * circ.radius - signedDist;
            circ.cx += nx * shift;
            circ.cy += ny * shift;
          }
        }
      }
    }

    for (const c of coincs) {
      if (c.type !== 'coincident') continue;
      const a = byId.get(c.entityAId);
      const b = byId.get(c.entityBId);
      if (a && b) {
        const pa = getPoint(a, c.pointA);
        const pb = getPoint(b, c.pointB);
        const mx = (pa[0] + pb[0]) * 0.5;
        const my = (pa[1] + pb[1]) * 0.5;
        setLinePoint(a, c.pointA, mx, my);
        setLinePoint(b, c.pointB, mx, my);
      }
    }

    for (const c of aligns) {
      if (c.type !== 'horizontal' && c.type !== 'vertical') continue;
      const ent = byId.get(c.entityId);
      if (!ent || ent.type !== 'line') continue;
      if (c.type === 'horizontal') {
        const midY = (ent.y1 + ent.y2) * 0.5;
        ent.y1 = midY;
        ent.y2 = midY;
      } else {
        const midX = (ent.x1 + ent.x2) * 0.5;
        ent.x1 = midX;
        ent.x2 = midX;
      }
    }
  }

  return entities;
}

export interface LoopSegment2D {
  kind: 'line' | 'arc';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx?: number;
  cy?: number;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
}

export interface SketchLoop2D {
  segments: LoopSegment2D[];
  isCircle?: boolean;
  circle?: { cx: number; cy: number; radius: number };
  polygon: Array<[number, number]>;
}

/**
 * Evaluates a smooth Catmull-Rom spline through control points.
 */
export function sampleSplinePoints(
  points: Array<[number, number]>,
  closed = false,
  subdivisions = 8
): Array<[number, number]> {
  if (points.length < 2) return points;
  if (points.length === 2) return [...points];
  const result: Array<[number, number]> = [];
  const n = points.length;
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const p0 = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];

    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      result.push([x, y]);
    }
  }
  if (!closed) result.push(points[n - 1]);
  return result;
}

/**
 * Extracts closed 2D loops from solved sketch entities for B-Rep wire construction & 2D polygon triangulation.
 */
export function extractClosedLoops(sketch: SketchData): SketchLoop2D[] {
  const solved = solveSketchConstraints(sketch.entities, sketch.constraints);
  const loops: SketchLoop2D[] = [];

  const openSegments: LoopSegment2D[] = [];

  for (const ent of solved) {
    if (ent.type === 'line' && ent.construction) continue;

    if (ent.type === 'circle') {
      if (ent.radius <= 0.05) continue;
      const poly: Array<[number, number]> = [];
      const steps = 32;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        poly.push([ent.cx + ent.radius * Math.cos(a), ent.cy + ent.radius * Math.sin(a)]);
      }
      loops.push({
        segments: [],
        isCircle: true,
        circle: { cx: ent.cx, cy: ent.cy, radius: ent.radius },
        polygon: poly,
      });
    } else if (ent.type === 'rect') {
      if (Math.abs(ent.width) <= 0.05 || Math.abs(ent.height) <= 0.05) continue;
      const x0 = ent.x;
      const y0 = ent.y;
      const x1 = ent.x + ent.width;
      const y1 = ent.y + ent.height;
      const pts: Array<[number, number]> = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      loops.push({
        segments: [
          { kind: 'line', x1: x0, y1: y0, x2: x1, y2: y0 },
          { kind: 'line', x1: x1, y1: y0, x2: x1, y2: y1 },
          { kind: 'line', x1: x1, y1: y1, x2: x0, y2: y1 },
          { kind: 'line', x1: x0, y1: y1, x2: x0, y2: y0 },
        ],
        polygon: pts,
      });
    } else if (ent.type === 'polygon') {
      const sides = Math.max(3, Math.round(ent.sides));
      if (ent.radius <= 0.05) continue;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pts.push([ent.cx + ent.radius * Math.cos(a), ent.cy + ent.radius * Math.sin(a)]);
      }
      const segments: LoopSegment2D[] = [];
      for (let i = 0; i < sides; i++) {
        const pA = pts[i];
        const pB = pts[(i + 1) % sides];
        segments.push({ kind: 'line', x1: pA[0], y1: pA[1], x2: pB[0], y2: pB[1] });
      }
      loops.push({ segments, polygon: pts });
    } else if (ent.type === 'slot') {
      const dx = ent.x2 - ent.x1;
      const dy = ent.y2 - ent.y1;
      const len = Math.hypot(dx, dy);
      const r = Math.max(0.2, ent.radius);
      const baseAngle = len > 1e-4 ? Math.atan2(dy, dx) : 0;
      const nx = -Math.sin(baseAngle);
      const ny = Math.cos(baseAngle);

      const p1Top: [number, number] = [ent.x1 + nx * r, ent.y1 + ny * r];
      const p2Top: [number, number] = [ent.x2 + nx * r, ent.y2 + ny * r];
      const p2Bot: [number, number] = [ent.x2 - nx * r, ent.y2 - ny * r];
      const p1Bot: [number, number] = [ent.x1 - nx * r, ent.y1 - ny * r];

      const segments: LoopSegment2D[] = [
        { kind: 'line', x1: p1Top[0], y1: p1Top[1], x2: p2Top[0], y2: p2Top[1] },
        {
          kind: 'arc',
          x1: p2Top[0],
          y1: p2Top[1],
          x2: p2Bot[0],
          y2: p2Bot[1],
          cx: ent.x2,
          cy: ent.y2,
          radius: r,
          startAngle: baseAngle + Math.PI / 2,
          endAngle: baseAngle - Math.PI / 2,
        },
        { kind: 'line', x1: p2Bot[0], y1: p2Bot[1], x2: p1Bot[0], y2: p1Bot[1] },
        {
          kind: 'arc',
          x1: p1Bot[0],
          y1: p1Bot[1],
          x2: p1Top[0],
          y2: p1Top[1],
          cx: ent.x1,
          cy: ent.y1,
          radius: r,
          startAngle: baseAngle - Math.PI / 2,
          endAngle: baseAngle - (3 * Math.PI) / 2,
        },
      ];

      const polygon: Array<[number, number]> = [p1Top, p2Top];
      for (let i = 1; i < 10; i++) {
        const a = baseAngle + Math.PI / 2 - (Math.PI * i) / 10;
        polygon.push([ent.x2 + r * Math.cos(a), ent.y2 + r * Math.sin(a)]);
      }
      polygon.push(p2Bot, p1Bot);
      for (let i = 1; i < 10; i++) {
        const a = baseAngle - Math.PI / 2 - (Math.PI * i) / 10;
        polygon.push([ent.x1 + r * Math.cos(a), ent.y1 + r * Math.sin(a)]);
      }
      loops.push({ segments, polygon });
    } else if (ent.type === 'spline') {
      if (ent.points.length >= 3) {
        const sampled = sampleSplinePoints(ent.points, Boolean(ent.closed), 6);
        if (sampled.length >= 3) {
          const segments: LoopSegment2D[] = [];
          for (let i = 0; i < sampled.length; i++) {
            const pA = sampled[i];
            const pB = sampled[(i + 1) % sampled.length];
            if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) > 1e-4) {
              segments.push({ kind: 'line', x1: pA[0], y1: pA[1], x2: pB[0], y2: pB[1] });
            }
          }
          if (segments.length >= 3) {
            loops.push({ segments, polygon: sampled });
          }
        }
      }
    } else if (ent.type === 'line') {
      if (Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1) > 1e-4) {
        openSegments.push({
          kind: 'line',
          x1: ent.x1,
          y1: ent.y1,
          x2: ent.x2,
          y2: ent.y2,
        });
      }
    } else if (ent.type === 'arc') {
      const sx = ent.cx + ent.radius * Math.cos(ent.startAngle);
      const sy = ent.cy + ent.radius * Math.sin(ent.startAngle);
      const ex = ent.cx + ent.radius * Math.cos(ent.endAngle);
      const ey = ent.cy + ent.radius * Math.sin(ent.endAngle);
      openSegments.push({
        kind: 'arc',
        x1: sx,
        y1: sy,
        x2: ex,
        y2: ey,
        cx: ent.cx,
        cy: ent.cy,
        radius: ent.radius,
        startAngle: ent.startAngle,
        endAngle: ent.endAngle,
      });
    }
  }

  // Chain open line/arc segments into closed loops (tolerance 0.5 mm)
  const used = new Array<boolean>(openSegments.length).fill(false);
  const tol = 0.5;

  for (let i = 0; i < openSegments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: LoopSegment2D[] = [{ ...openSegments[i] }];
    let curX = openSegments[i].x2;
    let curY = openSegments[i].y2;
    const startX = openSegments[i].x1;
    const startY = openSegments[i].y1;

    let progressed = true;
    while (progressed) {
      progressed = false;
      if (chain.length >= 2 && Math.hypot(curX - startX, curY - startY) < tol) {
        break;
      }
      for (let j = 0; j < openSegments.length; j++) {
        if (used[j]) continue;
        const seg = openSegments[j];
        if (Math.hypot(seg.x1 - curX, seg.y1 - curY) < tol) {
          used[j] = true;
          chain.push({ ...seg });
          curX = seg.x2;
          curY = seg.y2;
          progressed = true;
          break;
        }
        if (Math.hypot(seg.x2 - curX, seg.y2 - curY) < tol) {
          used[j] = true;
          const rev: LoopSegment2D = {
            ...seg,
            x1: seg.x2,
            y1: seg.y2,
            x2: seg.x1,
            y2: seg.y1,
            startAngle: seg.endAngle,
            endAngle: seg.startAngle,
          };
          chain.push(rev);
          curX = rev.x2;
          curY = rev.y2;
          progressed = true;
          break;
        }
      }
    }

    if (chain.length >= 2) {
      if (Math.hypot(curX - startX, curY - startY) >= tol) {
        chain.push({ kind: 'line', x1: curX, y1: curY, x2: startX, y2: startY });
      }
      const polygon: Array<[number, number]> = [];
      for (const s of chain) {
        if (s.kind === 'line') {
          polygon.push([s.x1, s.y1]);
        } else if (
          s.kind === 'arc' &&
          s.cx !== undefined &&
          s.cy !== undefined &&
          s.radius !== undefined &&
          s.startAngle !== undefined &&
          s.endAngle !== undefined
        ) {
          const steps = 16;
          for (let k = 0; k < steps; k++) {
            const t = k / steps;
            const a = s.startAngle + (s.endAngle - s.startAngle) * t;
            polygon.push([s.cx + s.radius * Math.cos(a), s.cy + s.radius * Math.sin(a)]);
          }
        }
      }
      if (polygon.length >= 3) {
        loops.push({ segments: chain, polygon });
      }
    }
  }

  return loops;
}
