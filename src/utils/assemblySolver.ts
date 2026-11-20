import { AssemblyComponent, AssemblyMate, TessellatedMesh } from '../types/cad';

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Rotates vector v by XYZ Euler angles (degrees).
 */
export function rotateVecEuler(
  v: [number, number, number],
  eulerDeg: [number, number, number]
): [number, number, number] {
  const rx = degToRad(eulerDeg[0]);
  const ry = degToRad(eulerDeg[1]);
  const rz = degToRad(eulerDeg[2]);

  let [x, y, z] = v;
  // X
  {
    const c = Math.cos(rx), s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny; z = nz;
  }
  // Y
  {
    const c = Math.cos(ry), s = Math.sin(ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx; z = nz;
  }
  // Z
  {
    const c = Math.cos(rz), s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx; y = ny;
  }
  return [x, y, z];
}

/**
 * Computes Euler XYZ angles (degrees) that rotate unit vector `from` onto unit vector `to`.
 */
export function eulerFromUnitVectors(
  from: [number, number, number],
  to: [number, number, number]
): [number, number, number] {
  const u = normalize(from);
  const v = normalize(to);
  const d = Math.max(-1, Math.min(1, dot(u, v)));

  let qx = 0, qy = 0, qz = 0, qw = 1;
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], u);
    if (Math.hypot(...axis) < 1e-5) axis = cross([0, 1, 0], u);
    axis = normalize(axis);
    qx = axis[0]; qy = axis[1]; qz = axis[2]; qw = 0;
  } else if (d > 0.999999) {
    return [0, 0, 0];
  } else {
    const c = cross(u, v);
    qw = 1 + d;
    qx = c[0]; qy = c[1]; qz = c[2];
    const len = Math.hypot(qx, qy, qz, qw);
    qx /= len; qy /= len; qz /= len; qw /= len;
  }

  // Quaternion to XYZ Euler
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m12 = 2 * (qx * qy - qz * qw);
  const m13 = 2 * (qx * qz + qy * qw);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m23 = 2 * (qy * qz - qx * qw);
  const m32 = 2 * (qy * qz + qx * qw);
  const m33 = 1 - 2 * (qx * qx + qy * qy);

  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  let rx = 0;
  let rz = 0;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  return [radToDeg(rx), radToDeg(ry), radToDeg(rz)];
}

/**
 * Resolves AssemblyMate constraints (Coincident, Concentric, Distance) sequentially
 * by moving componentB relative to fixed/already-placed componentA.
 */
export function solveAssemblyMates(
  componentsInput: AssemblyComponent[],
  mates: AssemblyMate[],
  partMeshes: Record<string, TessellatedMesh>
): AssemblyComponent[] {
  const components = componentsInput.map((c) => ({
    ...c,
    position: [...c.position] as [number, number, number],
    rotationEuler: [...c.rotationEuler] as [number, number, number],
  }));

  const byId = new Map<string, AssemblyComponent>();
  for (const c of components) byId.set(c.id, c);

  for (let pass = 0; pass < 3; pass++) {
    for (const mate of mates) {
      const compA = byId.get(mate.componentAId);
      const compB = byId.get(mate.componentBId);
      if (!compA || !compB) continue;

      const meshA = partMeshes[compA.partId];
      const meshB = partMeshes[compB.partId];
      if (!meshA || !meshB) continue;

      const faceA =
        meshA.faceInfos.find((f) => f.faceId === mate.faceAId) ?? meshA.faceInfos[0];
      const faceB =
        meshB.faceInfos.find((f) => f.faceId === mate.faceBId) ?? meshB.faceInfos[0];
      if (!faceA || !faceB) continue;

      const targetComp = compB.fixed && !compA.fixed ? compA : compB;
      const anchorComp = targetComp === compB ? compA : compB;
      const anchorFace = targetComp === compB ? faceA : faceB;
      const targetFace = targetComp === compB ? faceB : faceA;

      if (targetComp.fixed) continue;

      if (mate.type === 'coincident' || mate.type === 'distance') {
        const nAWorld = normalize(rotateVecEuler(anchorFace.normal, anchorComp.rotationEuler));
        const desiredNormalB: [number, number, number] = mate.flipNormal
          ? nAWorld
          : [-nAWorld[0], -nAWorld[1], -nAWorld[2]];

        const newEuler = eulerFromUnitVectors(targetFace.normal, desiredNormalB);
        targetComp.rotationEuler = newEuler;

        const rotCenterA = rotateVecEuler(anchorFace.center, anchorComp.rotationEuler);
        const worldCenterA: [number, number, number] = [
          anchorComp.position[0] + rotCenterA[0],
          anchorComp.position[1] + rotCenterA[1],
          anchorComp.position[2] + rotCenterA[2],
        ];

        const rotCenterB = rotateVecEuler(targetFace.center, newEuler);
        const offsetDist = mate.type === 'distance' ? (mate.distanceValue ?? 10) : 0;

        targetComp.position = [
          worldCenterA[0] + nAWorld[0] * offsetDist - rotCenterB[0],
          worldCenterA[1] + nAWorld[1] * offsetDist - rotCenterB[1],
          worldCenterA[2] + nAWorld[2] * offsetDist - rotCenterB[2],
        ];
      } else if (mate.type === 'concentric') {
        const axisA = anchorFace.cylinderAxis ?? anchorFace.normal;
        const axisB = targetFace.cylinderAxis ?? targetFace.normal;
        const axisAWorld = normalize(rotateVecEuler(axisA, anchorComp.rotationEuler));
        const desiredAxisB: [number, number, number] = mate.flipNormal
          ? [-axisAWorld[0], -axisAWorld[1], -axisAWorld[2]]
          : axisAWorld;

        const newEuler = eulerFromUnitVectors(axisB, desiredAxisB);
        targetComp.rotationEuler = newEuler;

        const rotCenterA = rotateVecEuler(anchorFace.center, anchorComp.rotationEuler);
        const worldCenterA: [number, number, number] = [
          anchorComp.position[0] + rotCenterA[0],
          anchorComp.position[1] + rotCenterA[1],
          anchorComp.position[2] + rotCenterA[2],
        ];
        const rotCenterB = rotateVecEuler(targetFace.center, newEuler);

        targetComp.position = [
          worldCenterA[0] - rotCenterB[0],
          worldCenterA[1] - rotCenterB[1],
          worldCenterA[2] - rotCenterB[2],
        ];
      } else if (mate.type === 'parallel') {
        const nAWorld = normalize(rotateVecEuler(anchorFace.normal, anchorComp.rotationEuler));
        const desiredNormalB: [number, number, number] = mate.flipNormal
          ? [-nAWorld[0], -nAWorld[1], -nAWorld[2]]
          : nAWorld;
        targetComp.rotationEuler = eulerFromUnitVectors(targetFace.normal, desiredNormalB);
      } else if (mate.type === 'perpendicular') {
        const nAWorld = normalize(rotateVecEuler(anchorFace.normal, anchorComp.rotationEuler));
        let ref: [number, number, number] = [0, 1, 0];
        if (Math.abs(dot(nAWorld, ref)) > 0.9) ref = [1, 0, 0];
        const perp = normalize(cross(nAWorld, ref));
        const desiredNormalB: [number, number, number] = mate.flipNormal
          ? [-perp[0], -perp[1], -perp[2]]
          : perp;
        targetComp.rotationEuler = eulerFromUnitVectors(targetFace.normal, desiredNormalB);
      } else if (mate.type === 'angle') {
        const nAWorld = normalize(rotateVecEuler(anchorFace.normal, anchorComp.rotationEuler));
        let rotAxis = cross(nAWorld, [0, 1, 0]);
        if (Math.hypot(...rotAxis) < 1e-4) rotAxis = cross(nAWorld, [1, 0, 0]);
        rotAxis = normalize(rotAxis);
        const rad = degToRad(mate.angleValue ?? 45);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const kCrossN = cross(rotAxis, nAWorld);
        const kDotN = dot(rotAxis, nAWorld);
        const tilted: [number, number, number] = [
          nAWorld[0] * c + kCrossN[0] * s + rotAxis[0] * kDotN * (1 - c),
          nAWorld[1] * c + kCrossN[1] * s + rotAxis[1] * kDotN * (1 - c),
          nAWorld[2] * c + kCrossN[2] * s + rotAxis[2] * kDotN * (1 - c),
        ];
        targetComp.rotationEuler = eulerFromUnitVectors(targetFace.normal, tilted);
      }
    }
  }

  return components;
}
