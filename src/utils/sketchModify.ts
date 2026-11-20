import { PlaneDefinition, SketchEntity } from '../types/cad';
import { world3DToSketch2D } from './sketchSolver';

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * Offsets a sketch entity inward or outward by `distance` mm (SolidWorks Offset Entities).
 */
export function offsetSketchEntity(
  ent: SketchEntity,
  distance: number
): SketchEntity | null {
  const id = uid('off');
  if (ent.type === 'circle') {
    const r = Math.max(0.5, ent.radius + distance);
    return { id, type: 'circle', cx: ent.cx, cy: ent.cy, radius: r };
  }
  if (ent.type === 'rect') {
    const nw = Math.max(1, ent.width + 2 * distance);
    const nh = Math.max(1, ent.height + 2 * distance);
    return {
      id,
      type: 'rect',
      x: ent.x - distance,
      y: ent.y - distance,
      width: nw,
      height: nh,
    };
  }
  if (ent.type === 'polygon') {
    const r = Math.max(0.5, ent.radius + distance);
    return { id, type: 'polygon', cx: ent.cx, cy: ent.cy, radius: r, sides: ent.sides };
  }
  if (ent.type === 'slot') {
    const r = Math.max(0.5, ent.radius + distance);
    return { id, type: 'slot', x1: ent.x1, y1: ent.y1, x2: ent.x2, y2: ent.y2, radius: r };
  }
  if (ent.type === 'line') {
    const dx = ent.x2 - ent.x1;
    const dy = ent.y2 - ent.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * distance;
    const ny = (dx / len) * distance;
    return {
      id,
      type: 'line',
      x1: ent.x1 + nx,
      y1: ent.y1 + ny,
      x2: ent.x2 + nx,
      y2: ent.y2 + ny,
    };
  }
  if (ent.type === 'arc') {
    return {
      id,
      type: 'arc',
      cx: ent.cx,
      cy: ent.cy,
      radius: Math.max(0.5, ent.radius + distance),
      startAngle: ent.startAngle,
      endAngle: ent.endAngle,
    };
  }
  return null;
}

/**
 * Mirrors a sketch entity across a centerline or X/Y axis (SolidWorks Mirror Entities).
 */
export function mirrorSketchEntity(
  ent: SketchEntity,
  axis: 'x' | 'y' | { x1: number; y1: number; x2: number; y2: number }
): SketchEntity {
  const mirrorPt = (x: number, y: number): [number, number] => {
    if (axis === 'x') return [x, -y];
    if (axis === 'y') return [-x, y];
    const dx = axis.x2 - axis.x1;
    const dy = axis.y2 - axis.y1;
    const l2 = dx * dx + dy * dy || 1;
    const t = ((x - axis.x1) * dx + (y - axis.y1) * dy) / l2;
    const px = axis.x1 + t * dx;
    const py = axis.y1 + t * dy;
    return [2 * px - x, 2 * py - y];
  };

  const id = uid('mir');
  if (ent.type === 'line') {
    const [nx1, ny1] = mirrorPt(ent.x1, ent.y1);
    const [nx2, ny2] = mirrorPt(ent.x2, ent.y2);
    return { id, type: 'line', x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
  }
  if (ent.type === 'rect') {
    const [a0, b0] = mirrorPt(ent.x, ent.y);
    const [a1, b1] = mirrorPt(ent.x + ent.width, ent.y + ent.height);
    return {
      id,
      type: 'rect',
      x: Math.min(a0, a1),
      y: Math.min(b0, b1),
      width: Math.abs(a1 - a0),
      height: Math.abs(b1 - b0),
    };
  }
  if (ent.type === 'circle') {
    const [cx, cy] = mirrorPt(ent.cx, ent.cy);
    return { id, type: 'circle', cx, cy, radius: ent.radius };
  }
  if (ent.type === 'polygon') {
    const [cx, cy] = mirrorPt(ent.cx, ent.cy);
    return { id, type: 'polygon', cx, cy, radius: ent.radius, sides: ent.sides };
  }
  if (ent.type === 'slot') {
    const [nx1, ny1] = mirrorPt(ent.x1, ent.y1);
    const [nx2, ny2] = mirrorPt(ent.x2, ent.y2);
    return { id, type: 'slot', x1: nx1, y1: ny1, x2: nx2, y2: ny2, radius: ent.radius };
  }
  if (ent.type === 'arc') {
    const [cx, cy] = mirrorPt(ent.cx, ent.cy);
    return {
      id,
      type: 'arc',
      cx,
      cy,
      radius: ent.radius,
      startAngle: Math.PI - ent.endAngle,
      endAngle: Math.PI - ent.startAngle,
    };
  }
  return {
    id,
    type: 'spline',
    points: ent.points.map(([px, py]) => mirrorPt(px, py)),
    closed: ent.closed,
  };
}

/**
 * Generates linear sketch pattern copies (SolidWorks Linear Sketch Pattern).
 */
export function linearPatternSketchEntity(
  ent: SketchEntity,
  countX: number,
  spacingX: number,
  countY = 1,
  spacingY = 20
): SketchEntity[] {
  const out: SketchEntity[] = [];
  for (let iy = 0; iy < Math.max(1, countY); iy++) {
    for (let ix = 0; ix < Math.max(1, countX); ix++) {
      if (ix === 0 && iy === 0) continue;
      const dx = ix * spacingX;
      const dy = iy * spacingY;
      out.push(translateSketchEntity(ent, dx, dy));
    }
  }
  return out;
}

/**
 * Generates circular sketch pattern copies around (cx, cy) (SolidWorks Circular Sketch Pattern).
 */
export function circularPatternSketchEntity(
  ent: SketchEntity,
  count: number,
  totalAngleDeg = 360,
  cx = 0,
  cy = 0
): SketchEntity[] {
  const out: SketchEntity[] = [];
  const n = Math.max(2, count);
  const full = Math.abs(totalAngleDeg - 360) < 1e-3;
  const stepDeg = full ? 360 / n : totalAngleDeg / (n - 1);

  for (let i = 1; i < n; i++) {
    const rad = (stepDeg * i * Math.PI) / 180;
    const rotPt = (x: number, y: number): [number, number] => {
      const rx = x - cx;
      const ry = y - cy;
      return [
        cx + rx * Math.cos(rad) - ry * Math.sin(rad),
        cy + rx * Math.sin(rad) + ry * Math.cos(rad),
      ];
    };
    const id = uid('cpat');
    if (ent.type === 'circle') {
      const [ncx, ncy] = rotPt(ent.cx, ent.cy);
      out.push({ id, type: 'circle', cx: ncx, cy: ncy, radius: ent.radius });
    } else if (ent.type === 'polygon') {
      const [ncx, ncy] = rotPt(ent.cx, ent.cy);
      out.push({ id, type: 'polygon', cx: ncx, cy: ncy, radius: ent.radius, sides: ent.sides });
    } else if (ent.type === 'line') {
      const [nx1, ny1] = rotPt(ent.x1, ent.y1);
      const [nx2, ny2] = rotPt(ent.x2, ent.y2);
      out.push({ id, type: 'line', x1: nx1, y1: ny1, x2: nx2, y2: ny2 });
    } else if (ent.type === 'slot') {
      const [nx1, ny1] = rotPt(ent.x1, ent.y1);
      const [nx2, ny2] = rotPt(ent.x2, ent.y2);
      out.push({ id, type: 'slot', x1: nx1, y1: ny1, x2: nx2, y2: ny2, radius: ent.radius });
    } else if (ent.type === 'rect') {
      const [ncx, ncy] = rotPt(ent.x + ent.width / 2, ent.y + ent.height / 2);
      out.push({
        id,
        type: 'rect',
        x: ncx - ent.width / 2,
        y: ncy - ent.height / 2,
        width: ent.width,
        height: ent.height,
      });
    }
  }
  return out;
}

function translateSketchEntity(ent: SketchEntity, dx: number, dy: number): SketchEntity {
  const id = uid('pat');
  if (ent.type === 'line') {
    return {
      id,
      type: 'line',
      x1: ent.x1 + dx,
      y1: ent.y1 + dy,
      x2: ent.x2 + dx,
      y2: ent.y2 + dy,
      construction: ent.construction,
    };
  }
  if (ent.type === 'rect') {
    return { id, type: 'rect', x: ent.x + dx, y: ent.y + dy, width: ent.width, height: ent.height };
  }
  if (ent.type === 'circle') {
    return { id, type: 'circle', cx: ent.cx + dx, cy: ent.cy + dy, radius: ent.radius };
  }
  if (ent.type === 'polygon') {
    return {
      id,
      type: 'polygon',
      cx: ent.cx + dx,
      cy: ent.cy + dy,
      radius: ent.radius,
      sides: ent.sides,
    };
  }
  if (ent.type === 'slot') {
    return {
      id,
      type: 'slot',
      x1: ent.x1 + dx,
      y1: ent.y1 + dy,
      x2: ent.x2 + dx,
      y2: ent.y2 + dy,
      radius: ent.radius,
    };
  }
  if (ent.type === 'arc') {
    return {
      id,
      type: 'arc',
      cx: ent.cx + dx,
      cy: ent.cy + dy,
      radius: ent.radius,
      startAngle: ent.startAngle,
      endAngle: ent.endAngle,
    };
  }
  return {
    id,
    type: 'spline',
    points: ent.points.map(([px, py]) => [px + dx, py + dy]),
    closed: ent.closed,
  };
}

/**
 * Projects a 3D B-Rep edge onto the active 2D sketch plane (SolidWorks Convert Entities).
 */
export function convertEdgeToSketchEntity(
  edgeMidpoint: [number, number, number],
  edgeTangent: [number, number, number],
  edgeLength: number,
  plane: PlaneDefinition
): SketchEntity {
  const half = edgeLength * 0.5;
  const p1World: [number, number, number] = [
    edgeMidpoint[0] - edgeTangent[0] * half,
    edgeMidpoint[1] - edgeTangent[1] * half,
    edgeMidpoint[2] - edgeTangent[2] * half,
  ];
  const p2World: [number, number, number] = [
    edgeMidpoint[0] + edgeTangent[0] * half,
    edgeMidpoint[1] + edgeTangent[1] * half,
    edgeMidpoint[2] + edgeTangent[2] * half,
  ];
  const [x1, y1] = world3DToSketch2D(p1World, plane);
  const [x2, y2] = world3DToSketch2D(p2World, plane);
  return {
    id: uid('conv'),
    type: 'line',
    x1: Math.round(x1 * 10) / 10,
    y1: Math.round(y1 * 10) / 10,
    x2: Math.round(x2 * 10) / 10,
    y2: Math.round(y2 * 10) / 10,
  };
}

/**
 * Trims the nearest sketch entity at click point (u, v): if a line crosses another line, trims
 * the clicked half; otherwise removes the clicked entity (SolidWorks Trim Entities - Power Trim).
 */
export function trimSketchEntityAtPoint(
  entities: SketchEntity[],
  u: number,
  v: number,
  tolerance = 5
): SketchEntity[] {
  let bestIdx = -1;
  let bestDist = tolerance;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    let d = Infinity;
    if (e.type === 'line' || e.type === 'slot') {
      d = distToSegment(u, v, e.x1, e.y1, e.x2, e.y2);
    } else if (e.type === 'circle' || e.type === 'polygon' || e.type === 'arc') {
      d = Math.abs(Math.hypot(u - e.cx, v - e.cy) - e.radius);
    } else if (e.type === 'rect') {
      const d1 = distToSegment(u, v, e.x, e.y, e.x + e.width, e.y);
      const d2 = distToSegment(u, v, e.x + e.width, e.y, e.x + e.width, e.y + e.height);
      const d3 = distToSegment(u, v, e.x + e.width, e.y + e.height, e.x, e.y + e.height);
      const d4 = distToSegment(u, v, e.x, e.y + e.height, e.x, e.y);
      d = Math.min(d1, d2, d3, d4);
    }
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return entities;
  const target = entities[bestIdx];
  if (target.type === 'line') {
    // Check intersection with any other line
    for (let j = 0; j < entities.length; j++) {
      if (j === bestIdx) continue;
      const other = entities[j];
      if (other.type !== 'line') continue;
      const hit = lineIntersection(
        target.x1,
        target.y1,
        target.x2,
        target.y2,
        other.x1,
        other.y1,
        other.x2,
        other.y2
      );
      if (hit) {
        const dStart = Math.hypot(u - target.x1, v - target.y1);
        const dEnd = Math.hypot(u - target.x2, v - target.y2);
        const trimmed: SketchEntity =
          dStart < dEnd
            ? { ...target, x1: hit[0], y1: hit[1] }
            : { ...target, x2: hit[0], y2: hit[1] };
        return entities.map((e, idx) => (idx === bestIdx ? trimmed : e));
      }
    }
  }
  return entities.filter((_, idx) => idx !== bestIdx);
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-8) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function lineIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number
): [number, number] | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  return null;
}
