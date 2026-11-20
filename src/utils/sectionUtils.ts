import { SectionAxis } from '../types/cad';

export interface ClipPlaneSpec {
  normal: [number, number, number];
  constant: number;
}

/**
 * Builds a clipping plane equation (normal . p + constant >= 0 is KEPT).
 * By default (flipped = false), keeps the negative/back side relative to +axis
 * so the +X / +Y / +Z isometric camera looks cleanly into the sliced interior.
 */
export function buildClippingPlaneSpec(
  axis: SectionAxis,
  offset: number,
  flipped: boolean
): ClipPlaneSpec {
  const sign = flipped ? 1 : -1;
  const normal: [number, number, number] =
    axis === 'x'
      ? [sign, 0, 0]
      : axis === 'y'
      ? [0, sign, 0]
      : [0, 0, sign];

  // Kept condition: sign * coord + constant >= 0
  // When sign = -1 (keep coord <= offset): -coord + offset >= 0 => constant = offset
  // When sign = +1 (keep coord >= offset):  coord - offset >= 0 => constant = -offset
  const constant = flipped ? -offset : offset;
  return { normal, constant };
}

/**
 * Returns signed distance normal . point + constant.
 * Points with value >= -epsilon are visible (not clipped away).
 */
export function signedDistanceToPlane(
  point: [number, number, number],
  plane: ClipPlaneSpec
): number {
  return (
    plane.normal[0] * point[0] +
    plane.normal[1] * point[1] +
    plane.normal[2] * point[2] +
    plane.constant
  );
}

export function isPointKeptByPlane(
  point: [number, number, number],
  plane: ClipPlaneSpec,
  epsilon = 1e-3
): boolean {
  return signedDistanceToPlane(point, plane) >= -epsilon;
}

/**
 * Computes exact intersection line segments where a triangle mesh crosses a clipping plane.
 * Used to render crisp CAD section-cut outlines along internal walls and holes.
 */
export function computeSectionContourSegments(
  positions: Float32Array,
  indices: Uint32Array,
  plane: ClipPlaneSpec,
  transformVertex?: (x: number, y: number, z: number) => [number, number, number]
): Float32Array {
  const segments: number[] = [];
  const triCount = indices.length / 3;
  const eps = 1e-5;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    const p0: [number, number, number] = transformVertex
      ? transformVertex(positions[i0], positions[i0 + 1], positions[i0 + 2])
      : [positions[i0], positions[i0 + 1], positions[i0 + 2]];
    const p1: [number, number, number] = transformVertex
      ? transformVertex(positions[i1], positions[i1 + 1], positions[i1 + 2])
      : [positions[i1], positions[i1 + 1], positions[i1 + 2]];
    const p2: [number, number, number] = transformVertex
      ? transformVertex(positions[i2], positions[i2 + 1], positions[i2 + 2])
      : [positions[i2], positions[i2 + 1], positions[i2 + 2]];

    const d0 = signedDistanceToPlane(p0, plane);
    const d1 = signedDistanceToPlane(p1, plane);
    const d2 = signedDistanceToPlane(p2, plane);

    const hits: Array<[number, number, number]> = [];
    const pairs: Array<[[number, number, number], number, [number, number, number], number]> = [
      [p0, d0, p1, d1],
      [p1, d1, p2, d2],
      [p2, d2, p0, d0],
    ];

    for (const [a, da, b, db] of pairs) {
      if ((da > eps && db < -eps) || (da < -eps && db > eps)) {
        const u = da / (da - db);
        hits.push([
          a[0] + u * (b[0] - a[0]),
          a[1] + u * (b[1] - a[1]),
          a[2] + u * (b[2] - a[2]),
        ]);
      } else if (Math.abs(da) <= eps && Math.abs(db) > eps) {
        hits.push(a);
      }
    }

    if (hits.length >= 2) {
      const a = hits[0];
      const b = hits[1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1e-4) {
        segments.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
  }

  return new Float32Array(segments);
}
