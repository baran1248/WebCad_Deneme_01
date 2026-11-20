import {
  FeaMeshData,
  FeaResult,
  FeaSettings,
  MaterialDef,
  TessellatedMesh,
} from '../types/cad';

export interface SolidVoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  h: number;
  origin: [number, number, number];
  active: Uint8Array;
  nodeGridMap: Int32Array;
  mesh: FeaMeshData;
}

/**
 * Ray-triangle Moller-Trumbore intersection along +X direction for inside/outside parity test.
 */
function rayIntersectsTriX(
  ox: number,
  oy: number,
  oz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number | null {
  // Quick YZ bbox reject
  const minY = Math.min(ay, by, cy);
  const maxY = Math.max(ay, by, cy);
  if (oy < minY || oy > maxY) return null;
  const minZ = Math.min(az, bz, cz);
  const maxZ = Math.max(az, bz, cz);
  if (oz < minZ || oz > maxZ) return null;

  // Project onto YZ plane (2D barycentric)
  const v0y = by - ay, v0z = bz - az;
  const v1y = cy - ay, v1z = cz - az;
  const det = v0y * v1z - v0z * v1y;
  if (Math.abs(det) < 1e-10) return null;

  const py = oy - ay;
  const pz = oz - az;
  const u = (py * v1z - pz * v1y) / det;
  const v = (v0y * pz - v0z * py) / det;
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return null;

  const t = (1 - u - v) * ax + u * bx + v * cx - ox;
  return t > 0 ? t : null;
}

function isPointInsideClosedMesh(
  px: number,
  py: number,
  pz: number,
  positions: Float32Array,
  indices: Uint32Array
): boolean {
  let hits = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const t = rayIntersectsTriX(
      px,
      py,
      pz,
      positions[a],
      positions[a + 1],
      positions[a + 2],
      positions[b],
      positions[b + 1],
      positions[b + 2],
      positions[c],
      positions[c + 1],
      positions[c + 2]
    );
    if (t !== null) hits++;
  }
  return (hits & 1) === 1;
}

/**
 * Generates a conformal 3D tetrahedral mesh from a closed CAD TessellatedMesh.
 */
export function generateTetrahedralMesh(
  cadMesh: TessellatedMesh,
  resolution: 'coarse' | 'medium' | 'fine'
): SolidVoxelGrid {
  const { min, max } = cadMesh.boundingBox;
  const dx = Math.max(1e-3, max[0] - min[0]);
  const dy = Math.max(1e-3, max[1] - min[1]);
  const dz = Math.max(1e-3, max[2] - min[2]);
  const maxDim = Math.max(dx, dy, dz);

  const targetDiv = resolution === 'coarse' ? 10 : resolution === 'medium' ? 15 : 20;
  const h = maxDim / targetDiv;

  const nx = Math.max(2, Math.min(32, Math.ceil(dx / h)));
  const ny = Math.max(2, Math.min(32, Math.ceil(dy / h)));
  const nz = Math.max(2, Math.min(32, Math.ceil(dz / h)));

  const active = new Uint8Array(nx * ny * nz);
  const { positions, indices, faceIds } = cadMesh;

  // Jitter slightly by irrational offset to avoid hitting triangle edges exactly
  const epsY = h * 0.00731;
  const epsZ = h * 0.01129;

  for (let k = 0; k < nz; k++) {
    const cz = min[2] + (k + 0.5) * h + epsZ;
    for (let j = 0; j < ny; j++) {
      const cy = min[1] + (j + 0.5) * h + epsY;
      for (let i = 0; i < nx; i++) {
        const cx = min[0] + (i + 0.5) * h;
        let inside = isPointInsideClosedMesh(cx, cy, cz, positions, indices);
        if (!inside) {
          // Sample 6 sub-offsets so thin flanges/walls are never missed
          const d = h * 0.32;
          let subHits = 0;
          if (isPointInsideClosedMesh(cx - d, cy, cz, positions, indices)) subHits++;
          if (isPointInsideClosedMesh(cx + d, cy, cz, positions, indices)) subHits++;
          if (isPointInsideClosedMesh(cx, cy - d, cz, positions, indices)) subHits++;
          if (isPointInsideClosedMesh(cx, cy + d, cz, positions, indices)) subHits++;
          if (isPointInsideClosedMesh(cx, cy, cz - d, positions, indices)) subHits++;
          if (isPointInsideClosedMesh(cx, cy, cz + d, positions, indices)) subHits++;
          if (subHits >= 2) inside = true;
        }
        if (inside) {
          active[i + nx * (j + ny * k)] = 1;
        }
      }
    }
  }

  // Ensure at least one active cell if thin geometry missed
  let activeCount = 0;
  for (let i = 0; i < active.length; i++) activeCount += active[i];
  if (activeCount === 0) {
    active[Math.floor(nx / 2) + nx * (Math.floor(ny / 2) + ny * Math.floor(nz / 2))] = 1;
  }

  // Allocate unique grid corner nodes for active cells
  const gnx = nx + 1;
  const gny = ny + 1;
  const gnz = nz + 1;
  const nodeGridMap = new Int32Array(gnx * gny * gnz).fill(-1);
  const nodeCoords: number[] = [];

  const getOrCreateNode = (gi: number, gj: number, gk: number): number => {
    const gIdx = gi + gnx * (gj + gny * gk);
    let nId = nodeGridMap[gIdx];
    if (nId === -1) {
      nId = nodeCoords.length / 3;
      nodeGridMap[gIdx] = nId;
      nodeCoords.push(
        Math.min(max[0], min[0] + gi * h),
        Math.min(max[1], min[1] + gj * h),
        Math.min(max[2], min[2] + gk * h)
      );
    }
    return nId;
  };

  // Subdivide each active hex into 5 conformal tetrahedra with positive orientation
  const tetsList: number[] = [];
  const surfTris: number[] = [];
  const surfFaceIds: number[] = [];

  // Precompute CAD triangle centroids for faceId mapping
  const triCount = indices.length / 3;
  const triCentroids = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    triCentroids[t * 3] = (positions[a] + positions[b] + positions[c]) / 3;
    triCentroids[t * 3 + 1] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    triCentroids[t * 3 + 2] = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
  }

  const findNearestFaceId = (x: number, y: number, z: number): number => {
    let bestDist = Infinity;
    let bestFace = 0;
    for (let t = 0; t < triCount; t++) {
      const dx1 = triCentroids[t * 3] - x;
      const dy1 = triCentroids[t * 3 + 1] - y;
      const dz1 = triCentroids[t * 3 + 2] - z;
      const d2 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
      if (d2 < bestDist) {
        bestDist = d2;
        bestFace = faceIds[t] ?? 0;
      }
    }
    return bestFace;
  };

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!active[i + nx * (j + ny * k)]) continue;

        const n000 = getOrCreateNode(i, j, k);
        const n100 = getOrCreateNode(i + 1, j, k);
        const n110 = getOrCreateNode(i + 1, j + 1, k);
        const n010 = getOrCreateNode(i, j + 1, k);
        const n001 = getOrCreateNode(i, j, k + 1);
        const n101 = getOrCreateNode(i + 1, j, k + 1);
        const n111 = getOrCreateNode(i + 1, j + 1, k + 1);
        const n011 = getOrCreateNode(i, j + 1, k + 1);

        // 5-tet decomposition with alternating parity for conforming diagonal edges
        const parity = (i + j + k) & 1;
        if (parity === 0) {
          tetsList.push(
            n000, n100, n110, n101,
            n000, n110, n010, n011,
            n000, n001, n101, n011,
            n111, n110, n101, n011,
            n000, n110, n101, n011
          );
        } else {
          tetsList.push(
            n100, n110, n010, n111,
            n000, n100, n010, n001,
            n001, n100, n101, n111,
            n001, n010, n011, n111,
            n100, n010, n001, n111
          );
        }

        // Check 6 neighbor cells for exposed boundary faces
        const isSolid = (ii: number, jj: number, kk: number) =>
          ii >= 0 &&
          ii < nx &&
          jj >= 0 &&
          jj < ny &&
          kk >= 0 &&
          kk < nz &&
          active[ii + nx * (jj + ny * kk)] === 1;

        const addQuad = (a: number, b: number, c: number, d: number) => {
          const cxq = (nodeCoords[a * 3] + nodeCoords[b * 3] + nodeCoords[c * 3] + nodeCoords[d * 3]) * 0.25;
          const cyq = (nodeCoords[a * 3 + 1] + nodeCoords[b * 3 + 1] + nodeCoords[c * 3 + 1] + nodeCoords[d * 3 + 1]) * 0.25;
          const czq = (nodeCoords[a * 3 + 2] + nodeCoords[b * 3 + 2] + nodeCoords[c * 3 + 2] + nodeCoords[d * 3 + 2]) * 0.25;
          const fId = findNearestFaceId(cxq, cyq, czq);
          surfTris.push(a, b, c, a, c, d);
          surfFaceIds.push(fId, fId);
        };

        if (!isSolid(i - 1, j, k)) addQuad(n000, n001, n011, n010);
        if (!isSolid(i + 1, j, k)) addQuad(n100, n110, n111, n101);
        if (!isSolid(i, j - 1, k)) addQuad(n000, n100, n101, n001);
        if (!isSolid(i, j + 1, k)) addQuad(n010, n011, n111, n110);
        if (!isSolid(i, j, k - 1)) addQuad(n000, n010, n110, n100);
        if (!isSolid(i, j, k + 1)) addQuad(n001, n101, n111, n011);
      }
    }
  }

  const nodes = new Float32Array(nodeCoords);
  const tets = new Uint32Array(tetsList);
  const surfaceTriangles = new Uint32Array(surfTris);
  const surfaceFaceIds = new Int32Array(surfFaceIds);

  return {
    nx,
    ny,
    nz,
    h,
    origin: [...min] as [number, number, number],
    active,
    nodeGridMap,
    mesh: {
      nodes,
      tets,
      surfaceTriangles,
      surfaceFaceIds,
      nodeCount: nodes.length / 3,
      elementCount: tets.length / 4,
    },
  };
}

/**
 * Computes 12x12 CST element stiffness matrix Ke (units: N/mm) and returns 6x12 B matrix + volume.
 */
function computeTetElement(
  nodes: Float32Array,
  n0: number,
  n1: number,
  n2: number,
  n3: number,
  E_MPa: number,
  nu: number
) {
  const x0 = nodes[n0 * 3], y0 = nodes[n0 * 3 + 1], z0 = nodes[n0 * 3 + 2];
  const x1 = nodes[n1 * 3], y1 = nodes[n1 * 3 + 1], z1 = nodes[n1 * 3 + 2];
  const x2 = nodes[n2 * 3], y2 = nodes[n2 * 3 + 1], z2 = nodes[n2 * 3 + 2];
  const x3 = nodes[n3 * 3], y3 = nodes[n3 * 3 + 1], z3 = nodes[n3 * 3 + 2];

  // Edge vectors from node 0
  const dx1 = x1 - x0, dy1 = y1 - y0, dz1 = z1 - z0;
  const dx2 = x2 - x0, dy2 = y2 - y0, dz2 = z2 - z0;
  const dx3 = x3 - x0, dy3 = y3 - y0, dz3 = z3 - z0;

  // Jacobian determinant = 6 * signed volume
  const detJ =
    dx1 * (dy2 * dz3 - dz2 * dy3) -
    dy1 * (dx2 * dz3 - dz2 * dx3) +
    dz1 * (dx2 * dy3 - dy2 * dx3);

  const vol = Math.abs(detJ) / 6;
  if (vol < 1e-9) {
    return null;
  }

  // Inverse Jacobian rows for shape function gradients
  // Using cofactor of 4x4 [1 x y z]:
  // Since detJ = 6V with sign, we compute exact derivatives dNi/dx, dNi/dy, dNi/dz via J^-T
  const invDet = 1 / detJ;
  // Cofactors of J = [dx1 dx2 dx3; dy1 dy2 dy3; dz1 dz2 dz3]
  const c11 = (dy2 * dz3 - dz2 * dy3) * invDet;
  const c12 = -(dx2 * dz3 - dz2 * dx3) * invDet;
  const c13 = (dx2 * dy3 - dy2 * dx3) * invDet;

  const c21 = -(dy1 * dz3 - dz1 * dy3) * invDet;
  const c22 = (dx1 * dz3 - dz1 * dx3) * invDet;
  const c23 = -(dx1 * dy3 - dy1 * dx3) * invDet;

  const c31 = (dy1 * dz2 - dz1 * dy2) * invDet;
  const c32 = -(dx1 * dz2 - dz1 * dx2) * invDet;
  const c33 = (dx1 * dy2 - dy1 * dx2) * invDet;

  // Gradients of N1, N2, N3, and N0 = -(N1+N2+N3)
  const bx1 = c11, by1 = c12, bz1 = c13;
  const bx2 = c21, by2 = c22, bz2 = c23;
  const bx3 = c31, by3 = c32, bz3 = c33;
  const bx0 = -(bx1 + bx2 + bx3);
  const by0 = -(by1 + by2 + by3);
  const bz0 = -(bz1 + bz2 + bz3);

  const bx = [bx0, bx1, bx2, bx3];
  const by = [by0, by1, by2, by3];
  const bz = [bz0, bz1, bz2, bz3];

  // 3D isotropic D matrix (MPa)
  const lam = (E_MPa * nu) / ((1 + nu) * (1 - 2 * nu));
  const mu = E_MPa / (2 * (1 + nu));
  const d11 = lam + 2 * mu;
  const d12 = lam;
  const d44 = mu;

  // Build 6x12 B matrix: rows = [exx, eyy, ezz, gxy, gyz, gzx]
  const B = new Float64Array(6 * 12);
  for (let a = 0; a < 4; a++) {
    const col = a * 3;
    B[0 * 12 + col] = bx[a];
    B[1 * 12 + col + 1] = by[a];
    B[2 * 12 + col + 2] = bz[a];

    B[3 * 12 + col] = by[a];
    B[3 * 12 + col + 1] = bx[a];

    B[4 * 12 + col + 1] = bz[a];
    B[4 * 12 + col + 2] = by[a];

    B[5 * 12 + col] = bz[a];
    B[5 * 12 + col + 2] = bx[a];
  }

  // DB = D * B (6x12)
  const DB = new Float64Array(6 * 12);
  for (let c = 0; c < 12; c++) {
    const b0 = B[0 * 12 + c];
    const b1 = B[1 * 12 + c];
    const b2 = B[2 * 12 + c];
    DB[0 * 12 + c] = d11 * b0 + d12 * b1 + d12 * b2;
    DB[1 * 12 + c] = d12 * b0 + d11 * b1 + d12 * b2;
    DB[2 * 12 + c] = d12 * b0 + d12 * b1 + d11 * b2;
    DB[3 * 12 + c] = d44 * B[3 * 12 + c];
    DB[4 * 12 + c] = d44 * B[4 * 12 + c];
    DB[5 * 12 + c] = d44 * B[5 * 12 + c];
  }

  // Ke = vol * B^T * DB (12x12)
  const Ke = new Float64Array(12 * 12);
  for (let i = 0; i < 12; i++) {
    for (let j = i; j < 12; j++) {
      let sum = 0;
      for (let r = 0; r < 6; r++) {
        sum += B[r * 12 + i] * DB[r * 12 + j];
      }
      const val = vol * sum;
      Ke[i * 12 + j] = val;
      Ke[j * 12 + i] = val;
    }
  }

  return { Ke, DB, vol };
}

/**
 * Solves 3D linear static FEA on a SolidVoxelGrid and projects stress & displacement onto the display mesh.
 */
export function solveStaticFea(
  grid: SolidVoxelGrid,
  cadMesh: TessellatedMesh,
  material: MaterialDef,
  settings: FeaSettings
): FeaResult {
  const tStart = performance.now();
  const { mesh } = grid;
  const { nodes, tets, surfaceTriangles, surfaceFaceIds, nodeCount, elementCount } = mesh;
  const dofCount = nodeCount * 3;

  // Convert E from Pa to MPa (N/mm^2) so mm + N yields MPa & mm cleanly
  const E_MPa = material.elasticModulus * 1e-6;
  const nu = material.poissonRatio;
  const yield_MPa = material.yieldStrength * 1e-6;

  // 1. Identify fixed DOFs from supports
  const fixedMask = new Uint8Array(dofCount);
  const fixedFaceSet = new Set<number>();
  for (const sup of settings.supports) {
    for (const f of sup.faceIds) fixedFaceSet.add(f);
  }

  let fixedNodeCount = 0;
  for (let t = 0; t < surfaceFaceIds.length; t++) {
    if (fixedFaceSet.has(surfaceFaceIds[t])) {
      for (let k = 0; k < 3; k++) {
        const nId = surfaceTriangles[t * 3 + k];
        if (!fixedMask[nId * 3]) fixedNodeCount++;
        fixedMask[nId * 3] = 1;
        fixedMask[nId * 3 + 1] = 1;
        fixedMask[nId * 3 + 2] = 1;
      }
    }
  }

  // Fallback if support face was too small to hit a voxel centroid: clamp closest nodes to support face center
  if (fixedNodeCount === 0 && settings.supports.length > 0) {
    const targetFaces = cadMesh.faceInfos.filter((f) => fixedFaceSet.has(f.faceId));
    if (targetFaces.length > 0) {
      for (const f of targetFaces) {
        for (let n = 0; n < nodeCount; n++) {
          const dx = nodes[n * 3] - f.center[0];
          const dy = nodes[n * 3 + 1] - f.center[1];
          const dz = nodes[n * 3 + 2] - f.center[2];
          // Check distance along face normal
          const planeDist = Math.abs(
            dx * f.normal[0] + dy * f.normal[1] + dz * f.normal[2]
          );
          if (planeDist <= grid.h * 1.15) {
            fixedMask[n * 3] = 1;
            fixedMask[n * 3 + 1] = 1;
            fixedMask[n * 3 + 2] = 1;
            fixedNodeCount++;
          }
        }
      }
    }
  }

  if (fixedNodeCount === 0) {
    // Fallback to bottom-most Y layer so solver never diverges on unconstrained model
    let minY = Infinity;
    for (let n = 0; n < nodeCount; n++) {
      if (nodes[n * 3 + 1] < minY) minY = nodes[n * 3 + 1];
    }
    for (let n = 0; n < nodeCount; n++) {
      if (nodes[n * 3 + 1] <= minY + grid.h * 0.6) {
        fixedMask[n * 3] = 1;
        fixedMask[n * 3 + 1] = 1;
        fixedMask[n * 3 + 2] = 1;
        fixedNodeCount++;
      }
    }
  }

  // 2. Assemble global force vector F (units: N)
  const F = new Float64Array(dofCount);
  for (const load of settings.loads) {
    if (load.faceIds.length === 0 || Math.abs(load.magnitude) < 1e-12) continue;
    const loadSet = new Set(load.faceIds);
    const matchingTris: number[] = [];
    let totalLoadedArea = 0;

    for (let t = 0; t < surfaceFaceIds.length; t++) {
      if (!loadSet.has(surfaceFaceIds[t])) continue;
      const a = surfaceTriangles[t * 3] * 3;
      const b = surfaceTriangles[t * 3 + 1] * 3;
      const c = surfaceTriangles[t * 3 + 2] * 3;
      const ux = nodes[b] - nodes[a], uy = nodes[b + 1] - nodes[a + 1], uz = nodes[b + 2] - nodes[a + 2];
      const vx = nodes[c] - nodes[a], vy = nodes[c + 1] - nodes[a + 1], vz = nodes[c + 2] - nodes[a + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      totalLoadedArea += area;
      matchingTris.push(t);
    }

    if (matchingTris.length === 0 || totalLoadedArea <= 1e-8) {
      // Proximity fallback to load face centers
      const targetFaces = cadMesh.faceInfos.filter((f) => loadSet.has(f.faceId));
      const matchedNodes: number[] = [];
      for (const f of targetFaces) {
        for (let n = 0; n < nodeCount; n++) {
          if (fixedMask[n * 3]) continue;
          const dx = nodes[n * 3] - f.center[0];
          const dy = nodes[n * 3 + 1] - f.center[1];
          const dz = nodes[n * 3 + 2] - f.center[2];
          const planeDist = Math.abs(dx * f.normal[0] + dy * f.normal[1] + dz * f.normal[2]);
          if (planeDist <= grid.h * 1.15) matchedNodes.push(n);
        }
      }
      if (matchedNodes.length > 0) {
        const dirLen = Math.hypot(...load.direction) || 1;
        const dx = load.direction[0] / dirLen;
        const dy = load.direction[1] / dirLen;
        const dz = load.direction[2] / dirLen;
        const totalForce =
          load.type === 'pressure'
            ? load.magnitude * targetFaces.reduce((s, f) => s + f.area, 0)
            : load.magnitude;
        const fn = totalForce / matchedNodes.length;
        for (const n of matchedNodes) {
          F[n * 3] += fn * dx;
          F[n * 3 + 1] += fn * dy;
          F[n * 3 + 2] += fn * dz;
        }
      }
      continue;
    }

    const dirLen = Math.hypot(...load.direction) || 1;
    const dux = load.direction[0] / dirLen;
    const duy = load.direction[1] / dirLen;
    const duz = load.direction[2] / dirLen;

    for (const t of matchingTris) {
      const n0 = surfaceTriangles[t * 3];
      const n1 = surfaceTriangles[t * 3 + 1];
      const n2 = surfaceTriangles[t * 3 + 2];
      const a = n0 * 3, b = n1 * 3, c = n2 * 3;
      const ux = nodes[b] - nodes[a], uy = nodes[b + 1] - nodes[a + 1], uz = nodes[b + 2] - nodes[a + 2];
      const vx = nodes[c] - nodes[a], vy = nodes[c + 1] - nodes[a + 1], vz = nodes[c + 2] - nodes[a + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const twoArea = Math.hypot(nx, ny, nz) || 1;
      const area = 0.5 * twoArea;
      nx /= twoArea; ny /= twoArea; nz /= twoArea;

      const fxDir = load.useFaceNormal ? -nx : dux;
      const fyDir = load.useFaceNormal ? -ny : duy;
      const fzDir = load.useFaceNormal ? -nz : duz;

      const triForce =
        load.type === 'pressure'
          ? load.magnitude * area
          : load.magnitude * (area / totalLoadedArea);

      const nodalShare = triForce / 3;
      for (const n of [n0, n1, n2]) {
        F[n * 3] += nodalShare * fxDir;
        F[n * 3 + 1] += nodalShare * fyDir;
        F[n * 3 + 2] += nodalShare * fzDir;
      }
    }
  }

  for (let i = 0; i < dofCount; i++) {
    if (fixedMask[i]) F[i] = 0;
  }

  // 3. Build sparse nodal neighbor CSR structure (max ~27 neighbors per node in 3D grid)
  const adjSets: Set<number>[] = Array.from({ length: nodeCount }, () => new Set<number>());
  const elemData: Array<{
    n: [number, number, number, number];
    Ke: Float64Array;
    DB: Float64Array;
    vol: number;
  } | null> = new Array(elementCount);

  for (let e = 0; e < elementCount; e++) {
    const n0 = tets[e * 4];
    const n1 = tets[e * 4 + 1];
    const n2 = tets[e * 4 + 2];
    const n3 = tets[e * 4 + 3];
    const res = computeTetElement(nodes, n0, n1, n2, n3, E_MPa, nu);
    if (!res) {
      elemData[e] = null;
      continue;
    }
    elemData[e] = { n: [n0, n1, n2, n3], ...res };
    const ns = [n0, n1, n2, n3];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        adjSets[ns[a]].add(ns[b]);
      }
    }
  }

  // Build block-3x3 CSR structure
  const rowPtr = new Int32Array(nodeCount + 1);
  let totalBlocks = 0;
  for (let i = 0; i < nodeCount; i++) {
    rowPtr[i] = totalBlocks;
    totalBlocks += adjSets[i].size;
  }
  rowPtr[nodeCount] = totalBlocks;

  const colIdx = new Int32Array(totalBlocks);
  const blockValues = new Float64Array(totalBlocks * 9);
  for (let i = 0; i < nodeCount; i++) {
    const sorted = Array.from(adjSets[i]).sort((a, b) => a - b);
    let p = rowPtr[i];
    for (const c of sorted) {
      colIdx[p++] = c;
    }
  }

  const findBlockSlot = (rowNode: number, colNode: number): number => {
    let lo = rowPtr[rowNode];
    let hi = rowPtr[rowNode + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = colIdx[mid];
      if (v === colNode) return mid * 9;
      if (v < colNode) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };

  for (let e = 0; e < elementCount; e++) {
    const ed = elemData[e];
    if (!ed) continue;
    const { n, Ke } = ed;
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const slot = findBlockSlot(n[a], n[b]);
        if (slot < 0) continue;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            blockValues[slot + r * 3 + c] += Ke[(a * 3 + r) * 12 + (b * 3 + c)];
          }
        }
      }
    }
  }

  // Extract diagonal for Jacobi preconditioner (respecting fixedMask)
  const invDiag = new Float64Array(dofCount);
  for (let i = 0; i < nodeCount; i++) {
    const slot = findBlockSlot(i, i);
    for (let r = 0; r < 3; r++) {
      const dof = i * 3 + r;
      if (fixedMask[dof]) {
        invDiag[dof] = 0;
      } else {
        const dVal = slot >= 0 ? blockValues[slot + r * 3 + r] : 1;
        invDiag[dof] = Math.abs(dVal) > 1e-12 ? 1 / dVal : 1;
      }
    }
  }

  // 4. Solve K * U = F via Jacobi-Preconditioned Conjugate Gradient (PCG)
  const U = new Float64Array(dofCount);
  const r = new Float64Array(dofCount);
  const z = new Float64Array(dofCount);
  const p = new Float64Array(dofCount);
  const Ap = new Float64Array(dofCount);

  for (let i = 0; i < dofCount; i++) {
    r[i] = fixedMask[i] ? 0 : F[i];
    z[i] = invDiag[i] * r[i];
    p[i] = z[i];
  }

  let rzOld = 0;
  let bNormSq = 0;
  for (let i = 0; i < dofCount; i++) {
    rzOld += r[i] * z[i];
    bNormSq += F[i] * F[i];
  }

  const tolSq = Math.max(1e-18, 1e-12 * bNormSq);
  const maxIter = Math.min(1800, Math.max(300, dofCount));

  if (bNormSq > 1e-16) {
    for (let iter = 0; iter < maxIter; iter++) {
      // Ap = K * p
      Ap.fill(0);
      for (let rowNode = 0; rowNode < nodeCount; rowNode++) {
        const s = rowPtr[rowNode];
        const ePtr = rowPtr[rowNode + 1];
        let a0 = 0, a1 = 0, a2 = 0;
        for (let ptr = s; ptr < ePtr; ptr++) {
          const colNode = colIdx[ptr];
          const p0 = p[colNode * 3];
          const p1 = p[colNode * 3 + 1];
          const p2 = p[colNode * 3 + 2];
          const off = ptr * 9;
          a0 += blockValues[off] * p0 + blockValues[off + 1] * p1 + blockValues[off + 2] * p2;
          a1 += blockValues[off + 3] * p0 + blockValues[off + 4] * p1 + blockValues[off + 5] * p2;
          a2 += blockValues[off + 6] * p0 + blockValues[off + 7] * p1 + blockValues[off + 8] * p2;
        }
        const d = rowNode * 3;
        Ap[d] = fixedMask[d] ? 0 : a0;
        Ap[d + 1] = fixedMask[d + 1] ? 0 : a1;
        Ap[d + 2] = fixedMask[d + 2] ? 0 : a2;
      }

      let pAp = 0;
      for (let i = 0; i < dofCount; i++) pAp += p[i] * Ap[i];
      if (Math.abs(pAp) < 1e-24) break;

      const alpha = rzOld / pAp;
      let rNormSq = 0;
      let rzNew = 0;
      for (let i = 0; i < dofCount; i++) {
        U[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        rNormSq += r[i] * r[i];
        z[i] = invDiag[i] * r[i];
        rzNew += r[i] * z[i];
      }

      if (rNormSq < tolSq) break;
      const beta = rzNew / (rzOld || 1e-24);
      for (let i = 0; i < dofCount; i++) {
        p[i] = z[i] + beta * p[i];
      }
      rzOld = rzNew;
    }
  }

  // 5. Post-process: Element stress -> Volume-weighted nodal Von Mises Stress (MPa)
  const nodeStressAccum = new Float64Array(nodeCount);
  const nodeWeightAccum = new Float64Array(nodeCount);
  const ue = new Float64Array(12);
  const sig = new Float64Array(6);

  for (let e = 0; e < elementCount; e++) {
    const ed = elemData[e];
    if (!ed) continue;
    const { n, DB, vol } = ed;
    for (let a = 0; a < 4; a++) {
      ue[a * 3] = U[n[a] * 3];
      ue[a * 3 + 1] = U[n[a] * 3 + 1];
      ue[a * 3 + 2] = U[n[a] * 3 + 2];
    }
    for (let rIdx = 0; rIdx < 6; rIdx++) {
      let val = 0;
      const rowOff = rIdx * 12;
      for (let c = 0; c < 12; c++) {
        val += DB[rowOff + c] * ue[c];
      }
      sig[rIdx] = val;
    }
    const sx = sig[0], sy = sig[1], sz = sig[2];
    const txy = sig[3], tyz = sig[4], tzx = sig[5];
    const vm = Math.sqrt(
      0.5 *
        ((sx - sy) * (sx - sy) +
          (sy - sz) * (sy - sz) +
          (sz - sx) * (sz - sx) +
          6 * (txy * txy + tyz * tyz + tzx * tzx))
    );
    for (let a = 0; a < 4; a++) {
      nodeStressAccum[n[a]] += vm * vol;
      nodeWeightAccum[n[a]] += vol;
    }
  }

  const nodeVonMises = new Float32Array(nodeCount);
  const nodeDisplacementMag = new Float32Array(nodeCount);
  let maxVonMises = 0;
  let minVonMises = Infinity;
  let maxDisplacement = 0;

  for (let n = 0; n < nodeCount; n++) {
    const vm = nodeWeightAccum[n] > 1e-12 ? nodeStressAccum[n] / nodeWeightAccum[n] : 0;
    nodeVonMises[n] = vm;
    const ux = U[n * 3], uy = U[n * 3 + 1], uz = U[n * 3 + 2];
    const dMag = Math.hypot(ux, uy, uz);
    nodeDisplacementMag[n] = dMag;
    if (vm > maxVonMises) maxVonMises = vm;
    if (vm < minVonMises) minVonMises = vm;
    if (dMag > maxDisplacement) maxDisplacement = dMag;
  }
  if (!Number.isFinite(minVonMises)) minVonMises = 0;

  // 6. Fast O(1) Grid-Cell projection from FEA nodes to CAD display mesh vertices
  const dispVertCount = cadMesh.positions.length / 3;
  const vertexVonMises = new Float32Array(dispVertCount);
  const vertexDisplacement = new Float32Array(dispVertCount * 3);
  const vertexDisplacementMag = new Float32Array(dispVertCount);
  const vertexSafetyFactor = new Float32Array(dispVertCount);

  const gnx = grid.nx + 1;
  const gny = grid.ny + 1;
  const gnz = grid.nz + 1;

  let minSafetyFactor = Infinity;

  for (let v = 0; v < dispVertCount; v++) {
    const px = cadMesh.positions[v * 3];
    const py = cadMesh.positions[v * 3 + 1];
    const pz = cadMesh.positions[v * 3 + 2];

    const fx = Math.max(0, Math.min(grid.nx - 1e-4, (px - grid.origin[0]) / grid.h));
    const fy = Math.max(0, Math.min(grid.ny - 1e-4, (py - grid.origin[1]) / grid.h));
    const fz = Math.max(0, Math.min(grid.nz - 1e-4, (pz - grid.origin[2]) / grid.h));

    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const k0 = Math.floor(fz);

    // Weighted IDW over the surrounding 27 grid vertices (3x3x3 stencil)
    let wSum = 0;
    let vmSum = 0;
    let uxSum = 0, uySum = 0, uzSum = 0;

    for (let dk = -1; dk <= 1; dk++) {
      const kk = k0 + dk;
      if (kk < 0 || kk >= gnz) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j0 + dj;
        if (jj < 0 || jj >= gny) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i0 + di;
          if (ii < 0 || ii >= gnx) continue;
          const nId = grid.nodeGridMap[ii + gnx * (jj + gny * kk)];
          if (nId < 0) continue;
          const dx = nodes[nId * 3] - px;
          const dy = nodes[nId * 3 + 1] - py;
          const dz = nodes[nId * 3 + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const w = 1 / (d2 + 1e-4);
          wSum += w;
          vmSum += w * nodeVonMises[nId];
          uxSum += w * U[nId * 3];
          uySum += w * U[nId * 3 + 1];
          uzSum += w * U[nId * 3 + 2];
        }
      }
    }

    // Fallback to nearest node if outside 3x3x3 stencil
    if (wSum === 0) {
      let bestDist = Infinity;
      let bestN = 0;
      for (let n = 0; n < nodeCount; n++) {
        const dx = nodes[n * 3] - px;
        const dy = nodes[n * 3 + 1] - py;
        const dz = nodes[n * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist) {
          bestDist = d2;
          bestN = n;
        }
      }
      vmSum = nodeVonMises[bestN];
      uxSum = U[bestN * 3];
      uySum = U[bestN * 3 + 1];
      uzSum = U[bestN * 3 + 2];
      wSum = 1;
    }

    const vm = vmSum / wSum;
    const ux = uxSum / wSum;
    const uy = uySum / wSum;
    const uz = uzSum / wSum;
    const dMag = Math.hypot(ux, uy, uz);
    const sf = vm > 1e-4 ? Math.min(15, yield_MPa / vm) : 15;

    vertexVonMises[v] = vm;
    vertexDisplacement[v * 3] = ux;
    vertexDisplacement[v * 3 + 1] = uy;
    vertexDisplacement[v * 3 + 2] = uz;
    vertexDisplacementMag[v] = dMag;
    vertexSafetyFactor[v] = sf;
    if (sf < minSafetyFactor) minSafetyFactor = sf;
  }

  if (!Number.isFinite(minSafetyFactor)) minSafetyFactor = 15;

  return {
    displacements: new Float32Array(U),
    nodeVonMises,
    nodeDisplacementMag,
    vertexVonMises,
    vertexDisplacement,
    vertexDisplacementMag,
    vertexSafetyFactor,
    maxVonMises,
    minVonMises,
    maxDisplacement,
    minSafetyFactor,
    solveTimeMs: Math.round(performance.now() - tStart),
    dofCount,
    elementCount,
  };
}

/**
 * Ansys / Jet scientific colormap (0..1 -> [r, g, b] in 0..1).
 */
export function jetColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [r, g, b];
}
