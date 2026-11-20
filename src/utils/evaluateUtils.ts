import {
  AssemblyComponent,
  FaceInfo,
  InterferencePair,
  TessellatedMesh,
} from '../types/cad';
import { rotateVecEuler } from './assemblySolver';

export interface MomentsOfInertia {
  Ixx: number; // kg·mm^2
  Iyy: number; // kg·mm^2
  Izz: number; // kg·mm^2
}

/**
 * Computes exact moments of inertia about the center of mass using divergence-theorem
 * tetrahedral integration over a closed triangle mesh.
 */
export function computeMomentsOfInertia(
  positions: Float32Array,
  indices: Uint32Array,
  centerOfMass: [number, number, number],
  densityKgM3: number
): MomentsOfInertia {
  const [cx, cy, cz] = centerOfMass;
  let signedVol = 0;
  let covXX = 0;
  let covYY = 0;
  let covZZ = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;

    const ax = positions[ia] - cx;
    const ay = positions[ia + 1] - cy;
    const az = positions[ia + 2] - cz;

    const bx = positions[ib] - cx;
    const by = positions[ib + 1] - cy;
    const bz = positions[ib + 2] - cz;

    const cxp = positions[ic] - cx;
    const cyp = positions[ic + 1] - cy;
    const czp = positions[ic + 2] - cz;

    const det =
      ax * (by * czp - bz * cyp) -
      ay * (bx * czp - bz * cxp) +
      az * (bx * cyp - by * cxp);

    signedVol += det;

    // Exact integral of x^2 over tetrahedron (0, a, b, c) is (det / 60) * (ax^2 + bx^2 + cxp^2 + ax*bx + ax*cxp + bx*cxp)
    const sx = ax * ax + bx * bx + cxp * cxp + ax * bx + ax * cxp + bx * cxp;
    const sy = ay * ay + by * by + cyp * cyp + ay * by + ay * cyp + by * cyp;
    const sz = az * az + bz * bz + czp * czp + az * bz + az * czp + bz * czp;

    covXX += det * sx;
    covYY += det * sy;
    covZZ += det * sz;
  }

  const sign = signedVol >= 0 ? 1 : -1;
  const densityKgMm3 = densityKgM3 * 1e-9;
  const cXX = (sign * covXX) / 60;
  const cYY = (sign * covYY) / 60;
  const cZZ = (sign * covZZ) / 60;

  return {
    Ixx: Math.max(0, (cYY + cZZ) * densityKgMm3),
    Iyy: Math.max(0, (cXX + cZZ) * densityKgMm3),
    Izz: Math.max(0, (cXX + cYY) * densityKgMm3),
  };
}

/**
 * Computes per-vertex RGB colors for SolidWorks Draft Analysis:
 * - Green: Positive draft (> +1 deg from perpendicular to pull axis)
 * - Yellow: Vertical / near-0 deg wall (-1 deg .. +1 deg)
 * - Red: Negative draft / undercut (< -1 deg)
 */
export function computeVertexDraftColors(
  positions: Float32Array,
  normals: Float32Array,
  pullAxis: 'x' | 'y' | 'z' = 'y'
): Float32Array {
  const vCount = positions.length / 3;
  const colors = new Float32Array(positions.length);
  const px = pullAxis === 'x' ? 1 : 0;
  const py = pullAxis === 'y' ? 1 : 0;
  const pz = pullAxis === 'z' ? 1 : 0;
  const sin1Deg = Math.sin((1 * Math.PI) / 180);

  for (let i = 0; i < vCount; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    const dotPull = (nx * px + ny * py + nz * pz) / len;

    if (dotPull > sin1Deg) {
      // Positive draft -> Green
      colors[i * 3] = 0.16;
      colors[i * 3 + 1] = 0.78;
      colors[i * 3 + 2] = 0.36;
    } else if (dotPull < -sin1Deg) {
      // Negative draft / undercut -> Red
      colors[i * 3] = 0.92;
      colors[i * 3 + 1] = 0.24;
      colors[i * 3 + 2] = 0.22;
    } else {
      // Straddle / vertical wall -> Yellow
      colors[i * 3] = 0.96;
      colors[i * 3 + 1] = 0.82;
      colors[i * 3 + 2] = 0.14;
    }
  }
  return colors;
}

/**
 * Computes per-vertex RGB colors for SolidWorks Curvature Analysis:
 * Planar surfaces render in neutral slate-blue; cylindrical/fillet curved regions
 * highlight along cyan-orange-red based on curvature 1/R or vertex normal variation.
 */
export function computeVertexCurvatureColors(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  faceInfos: FaceInfo[],
  faceIds: Int32Array
): Float32Array {
  const colors = new Float32Array(positions.length);
  const faceById = new Map<number, FaceInfo>();
  for (const fi of faceInfos) faceById.set(fi.faceId, fi);

  // Default planar cool gray-blue
  for (let i = 0; i < positions.length; i += 3) {
    colors[i] = 0.42;
    colors[i + 1] = 0.52;
    colors[i + 2] = 0.64;
  }

  for (let t = 0; t < faceIds.length; t++) {
    const fi = faceById.get(faceIds[t]);
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];

    let curv = 0;
    if (fi?.isCylindrical && fi.cylinderRadius && fi.cylinderRadius > 0) {
      curv = Math.min(1, 5 / fi.cylinderRadius);
    } else {
      // Measure normal spread across triangle vertices as local curvature estimate
      const nax = normals[ia * 3], nay = normals[ia * 3 + 1], naz = normals[ia * 3 + 2];
      const nbx = normals[ib * 3], nby = normals[ib * 3 + 1], nbz = normals[ib * 3 + 2];
      const ncx = normals[ic * 3], ncy = normals[ic * 3 + 1], ncz = normals[ic * 3 + 2];
      const d1 = Math.hypot(nbx - nax, nby - nay, nbz - naz);
      const d2 = Math.hypot(ncx - nax, ncy - nay, ncz - naz);
      curv = Math.min(1, Math.max(d1, d2) * 1.6);
    }

    if (curv > 0.04) {
      // Blend from cyan (low curvature) -> amber -> red (high curvature / tight fillet)
      const r = Math.min(1, curv * 1.4);
      const g = Math.max(0.15, 0.85 - Math.abs(curv - 0.5) * 1.1);
      const b = Math.max(0.1, 0.9 - curv * 1.2);
      for (const vi of [ia, ib, ic]) {
        colors[vi * 3] = r;
        colors[vi * 3 + 1] = g;
        colors[vi * 3 + 2] = b;
      }
    }
  }

  return colors;
}

/**
 * Computes angle in degrees between two face normals (0..180°).
 */
export function measureFacesAngleDeg(faceA: FaceInfo, faceB: FaceInfo): number {
  const la = Math.hypot(...faceA.normal) || 1;
  const lb = Math.hypot(...faceB.normal) || 1;
  const d =
    (faceA.normal[0] * faceB.normal[0] +
      faceA.normal[1] * faceB.normal[1] +
      faceA.normal[2] * faceB.normal[2]) /
    (la * lb);
  const clamped = Math.max(-1, Math.min(1, d));
  return (Math.acos(clamped) * 180) / Math.PI;
}

interface WorldMeshBox {
  component: AssemblyComponent;
  mesh: TessellatedMesh;
  min: [number, number, number];
  max: [number, number, number];
  worldTris: Float32Array;
}

function buildWorldBox(
  comp: AssemblyComponent,
  mesh: TessellatedMesh
): WorldMeshBox {
  const worldTris = new Float32Array(mesh.indices.length * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < mesh.indices.length; i++) {
    const vi = mesh.indices[i] * 3;
    const rot = rotateVecEuler(
      [mesh.positions[vi], mesh.positions[vi + 1], mesh.positions[vi + 2]],
      comp.rotationEuler
    );
    const wx = rot[0] + comp.position[0];
    const wy = rot[1] + comp.position[1];
    const wz = rot[2] + comp.position[2];
    worldTris[i * 3] = wx;
    worldTris[i * 3 + 1] = wy;
    worldTris[i * 3 + 2] = wz;
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wz < minZ) minZ = wz;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
    if (wz > maxZ) maxZ = wz;
  }

  return {
    component: comp,
    mesh,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    worldTris,
  };
}

function isPointInsideWorldMesh(
  px: number,
  py: number,
  pz: number,
  worldTris: Float32Array
): boolean {
  // Raycast along +X using Möller–Trumbore parity test
  let hits = 0;
  const EPS = 1e-6;
  for (let i = 0; i < worldTris.length; i += 9) {
    const ax = worldTris[i], ay = worldTris[i + 1], az = worldTris[i + 2];
    const bx = worldTris[i + 3], by = worldTris[i + 4], bz = worldTris[i + 5];
    const cx = worldTris[i + 6], cy = worldTris[i + 7], cz = worldTris[i + 8];

    // Quick Y/Z bbox reject
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    if (py < minY - EPS || py > maxY + EPS) continue;
    const minZ = Math.min(az, bz, cz);
    const maxZ = Math.max(az, bz, cz);
    if (pz < minZ - EPS || pz > maxZ + EPS) continue;

    // Edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // Ray dir = (1, 0, 0) => P = dir x e2 = (0, -e2z, e2y)
    const pvecY = -e2z;
    const pvecZ = e2y;
    const det = e1y * pvecY + e1z * pvecZ;
    if (Math.abs(det) < 1e-8) continue;

    const invDet = 1 / det;
    const tvecX = px - ax;
    const tvecY = py - ay;
    const tvecZ = pz - az;

    const u = (tvecY * pvecY + tvecZ * pvecZ) * invDet;
    if (u < 0 || u > 1) continue;

    // Q = tvec x e1
    const qx = tvecY * e1z - tvecZ * e1y;
    const qy = tvecZ * e1x - tvecX * e1z;
    const qz = tvecX * e1y - tvecY * e1x;

    const v = qx * invDet;
    if (v < 0 || u + v > 1) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t > 1e-4) hits++;
  }
  return hits % 2 === 1;
}

/**
 * Detects physical 3D solid interferences between assembly component pairs using
 * AABB intersection + uniform voxel parity sampling (SolidWorks Interference Detection).
 */
export function detectAssemblyInterference(
  components: AssemblyComponent[],
  partMeshes: Record<string, TessellatedMesh>
): InterferencePair[] {
  const boxes: WorldMeshBox[] = [];
  for (const c of components) {
    const m = partMeshes[c.partId];
    if (m && m.indices.length >= 3) {
      boxes.push(buildWorldBox(c, m));
    }
  }

  const pairs: InterferencePair[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      const ix0 = Math.max(A.min[0], B.min[0]);
      const iy0 = Math.max(A.min[1], B.min[1]);
      const iz0 = Math.max(A.min[2], B.min[2]);
      const ix1 = Math.min(A.max[0], B.max[0]);
      const iy1 = Math.min(A.max[1], B.max[1]);
      const iz1 = Math.min(A.max[2], B.max[2]);

      const sx = ix1 - ix0;
      const sy = iy1 - iy0;
      const sz = iz1 - iz0;
      // Ignore tiny touching tolerance (< 0.4 mm)
      if (sx <= 0.4 || sy <= 0.4 || sz <= 0.4) continue;

      const N = 6;
      const dv = (sx * sy * sz) / (N * N * N);
      let insideCount = 0;
      let sumX = 0, sumY = 0, sumZ = 0;

      for (let gx = 0; gx < N; gx++) {
        const px = ix0 + ((gx + 0.5) / N) * sx;
        for (let gy = 0; gy < N; gy++) {
          const py = iy0 + ((gy + 0.5) / N) * sy;
          for (let gz = 0; gz < N; gz++) {
            const pz = iz0 + ((gz + 0.5) / N) * sz;
            if (
              isPointInsideWorldMesh(px, py, pz, A.worldTris) &&
              isPointInsideWorldMesh(px, py, pz, B.worldTris)
            ) {
              insideCount++;
              sumX += px;
              sumY += py;
              sumZ += pz;
            }
          }
        }
      }

      if (insideCount > 0) {
        const volMm3 = insideCount * dv;
        pairs.push({
          componentAName: A.component.name,
          componentBName: B.component.name,
          overlapVolumeCm3: volMm3 / 1000,
          overlapCenter: [sumX / insideCount, sumY / insideCount, sumZ / insideCount],
        });
      }
    }
  }

  return pairs;
}

/**
 * Computes exploded assembly component positions radiating outward from assembly centroid
 * (SolidWorks Exploded View).
 */
export function computeExplodedComponents(
  components: AssemblyComponent[],
  partMeshes: Record<string, TessellatedMesh>,
  explodeFactor: number
): AssemblyComponent[] {
  if (explodeFactor <= 1e-4 || components.length <= 1) {
    return components;
  }

  const worldCenters = components.map((comp) => {
    const mesh = partMeshes[comp.partId];
    const localCenter: [number, number, number] = mesh
      ? mesh.centerOfMass
      : [0, 0, 0];
    const rot = rotateVecEuler(localCenter, comp.rotationEuler);
    return [
      comp.position[0] + rot[0],
      comp.position[1] + rot[1],
      comp.position[2] + rot[2],
    ] as [number, number, number];
  });

  let cx = 0, cy = 0, cz = 0;
  for (const wc of worldCenters) {
    cx += wc[0];
    cy += wc[1];
    cz += wc[2];
  }
  cx /= worldCenters.length;
  cy /= worldCenters.length;
  cz /= worldCenters.length;

  return components.map((comp, idx) => {
    const wc = worldCenters[idx];
    let dx = wc[0] - cx;
    let dy = wc[1] - cy;
    let dz = wc[2] - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) {
      dx = idx % 2 === 0 ? -25 : 25;
      dy = 15;
      dz = 20;
    } else {
      const boost = Math.max(35, len);
      dx = (dx / len) * boost;
      dy = (dy / len) * boost;
      dz = (dz / len) * boost;
    }
    return {
      ...comp,
      position: [
        comp.position[0] + dx * explodeFactor,
        comp.position[1] + dy * explodeFactor,
        comp.position[2] + dz * explodeFactor,
      ],
    };
  });
}
