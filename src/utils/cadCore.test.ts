import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject } from '../data/defaultProject';
import { getMaterialById } from '../data/materials';
import { solveSketchConstraints, extractClosedLoops, sketch2DTo3D, resolvePlane } from './sketchSolver';
import {
  exportMeshToOBJ,
  parseOBJ,
  exportMeshToSTL,
  parseSTL,
  exportMeshToIGES,
  parseIGES,
  serializeProjectToMcadJson,
  parseMcadJson,
} from './cadFormats';
import { solveAssemblyMates } from './assemblySolver';
import { generateTetrahedralMesh, solveStaticFea, jetColor } from './feaMesherAndSolver';
import {
  distanceBetweenPoints,
  extractUniqueVertices,
  getAllowedPickTargets,
  toggleSelectionId,
} from './selectionUtils';
import {
  buildClippingPlaneSpec,
  computeSectionContourSegments,
  isPointKeptByPlane,
} from './sectionUtils';
import {
  circularPatternSketchEntity,
  linearPatternSketchEntity,
  mirrorSketchEntity,
  offsetSketchEntity,
  trimSketchEntityAtPoint,
} from './sketchModify';
import {
  computeExplodedComponents,
  computeMomentsOfInertia,
  detectAssemblyInterference,
  measureFacesAngleDeg,
} from './evaluateUtils';
import { TessellatedMesh } from '../types/cad';

function makeBoxTessellatedMesh(sx = 40, sy = 20, sz = 20): TessellatedMesh {
  // 8 vertices, 12 triangles (6 faces, faceId 0..5)
  const positions = new Float32Array([
    // -X (face 0)
    0, 0, 0,  0, 0, sz,  0, sy, sz,  0, sy, 0,
    // +X (face 1)
    sx, 0, 0,  sx, sy, 0,  sx, sy, sz,  sx, 0, sz,
    // -Y (face 2)
    0, 0, 0,  sx, 0, 0,  sx, 0, sz,  0, 0, sz,
    // +Y (face 3)
    0, sy, 0,  0, sy, sz,  sx, sy, sz,  sx, sy, 0,
    // -Z (face 4)
    0, 0, 0,  0, sy, 0,  sx, sy, 0,  sx, 0, 0,
    // +Z (face 5)
    0, 0, sz,  sx, 0, sz,  sx, sy, sz,  0, sy, sz,
  ]);
  const normals = new Float32Array([
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
     1,0,0,  1,0,0,  1,0,0,  1,0,0,
     0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
     0,1,0,  0,1,0,  0,1,0,  0,1,0,
     0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
     0,0,1,  0,0,1,  0,0,1,  0,0,1,
  ]);
  const indices = new Uint32Array([
    0,1,2, 0,2,3,
    4,5,6, 4,6,7,
    8,9,10, 8,10,11,
    12,13,14, 12,14,15,
    16,17,18, 16,18,19,
    20,21,22, 20,22,23,
  ]);
  const faceIds = new Int32Array([0,0, 1,1, 2,2, 3,3, 4,4, 5,5]);
  return {
    positions,
    normals,
    indices,
    faceIds,
    edgePositions: new Float32Array([0, 0, 0, sx, 0, 0]),
    edgeIds: new Int32Array([0]),
    faceInfos: [
      { faceId: 0, center: [0, sy/2, sz/2], normal: [-1,0,0], area: sy*sz, isCylindrical: false },
      { faceId: 1, center: [sx, sy/2, sz/2], normal: [1,0,0], area: sy*sz, isCylindrical: false },
      { faceId: 2, center: [sx/2, 0, sz/2], normal: [0,-1,0], area: sx*sz, isCylindrical: false },
      { faceId: 3, center: [sx/2, sy, sz/2], normal: [0,1,0], area: sx*sz, isCylindrical: false },
      { faceId: 4, center: [sx/2, sy/2, 0], normal: [0,0,-1], area: sx*sy, isCylindrical: false },
      { faceId: 5, center: [sx/2, sy/2, sz], normal: [0,0,1], area: sx*sy, isCylindrical: false },
    ],
    edgeInfos: [{ edgeId: 0, midpoint: [sx/2, 0, 0], length: sx, tangent: [1,0,0] }],
    vertexPositions: new Float32Array([0, 0, 0, sx, 0, 0, 0, sy, 0, sx, sy, 0]),
    vertexInfos: [
      { vertexId: 0, position: [0, 0, 0] },
      { vertexId: 1, position: [sx, 0, 0] },
      { vertexId: 2, position: [0, sy, 0] },
      { vertexId: 3, position: [sx, sy, 0] },
    ],
    boundingBox: { min: [0, 0, 0], max: [sx, sy, sz] },
    volume: sx * sy * sz,
    surfaceArea: 2 * (sx * sy + sy * sz + sx * sz),
    centerOfMass: [sx / 2, sy / 2, sz / 2],
    kernelSource: 'fallback',
  };
}

test('sketch constraint solver enforces horizontal, vertical, coincident, and dimension constraints', () => {
  const solved = solveSketchConstraints(
    [
      { id: 'l1', type: 'line', x1: 0, y1: 0, x2: 50, y2: 3 },
      { id: 'l2', type: 'line', x1: 52, y1: 5, x2: 50, y2: 40 },
    ],
    [
      { id: 'c1', type: 'horizontal', entityId: 'l1' },
      { id: 'c2', type: 'vertical', entityId: 'l2' },
      { id: 'c3', type: 'coincident', entityAId: 'l1', pointA: 'end', entityBId: 'l2', pointB: 'start' },
      { id: 'c4', type: 'dimension', entityId: 'l1', param: 'length', value: 80 },
    ]
  );
  const l1 = solved[0];
  const l2 = solved[1];
  assert.equal(l1.type, 'line');
  assert.equal(l2.type, 'line');
  if (l1.type === 'line' && l2.type === 'line') {
    assert.ok(Math.abs(l1.y1 - l1.y2) < 0.01);
    assert.ok(Math.abs(l2.x1 - l2.x2) < 0.01);
    assert.ok(Math.abs(Math.hypot(l1.x2 - l1.x1, l1.y2 - l1.y1) - 80) < 0.1);
    assert.ok(Math.hypot(l1.x2 - l2.x1, l1.y2 - l2.y1) < 0.5);
  }
});

test('extractClosedLoops extracts default bracket L-profile and circle loops', () => {
  const proj = createDefaultProject();
  const part = proj.parts[0];
  const loops1 = extractClosedLoops(part.sketches[0]);
  assert.equal(loops1.length, 1);
  assert.equal(loops1[0].polygon.length, 6);

  const loops2 = extractClosedLoops(part.sketches[1]);
  assert.equal(loops2.length, 2);
  assert.equal(loops2[0].isCircle, true);

  const topPlane = resolvePlane('top', 16);
  const p3d = sketch2DTo3D(10, 5, topPlane);
  assert.deepEqual(p3d, [10, 16, -5]);
});

test('CAD exporters and parsers round-trip OBJ, STL, IGES 5.3, and .mcad.json', () => {
  const box = makeBoxTessellatedMesh(20, 10, 10);

  const obj = exportMeshToOBJ(box, 'TestBox');
  const parsedObj = parseOBJ(obj);
  assert.equal(parsedObj.indices.length, 36);

  const stl = exportMeshToSTL(box, 'TestBox');
  const parsedStl = parseSTL(new TextEncoder().encode(stl).buffer);
  assert.equal(parsedStl.indices.length, 36);

  const iges = exportMeshToIGES(box, 'TestBox');
  assert.ok(iges.includes('G      1'));
  assert.ok(iges.includes('T      1'));
  const parsedIges = parseIGES(iges);
  assert.equal(parsedIges.indices.length, 36);

  const proj = createDefaultProject();
  const json = serializeProjectToMcadJson(proj);
  const restored = parseMcadJson(json);
  assert.equal(restored.name, proj.name);
});

test('Assembly mate solver aligns coincident face B against fixed component A', () => {
  const boxA = makeBoxTessellatedMesh(40, 20, 20);
  const boxB = makeBoxTessellatedMesh(20, 20, 20);
  const result = solveAssemblyMates(
    [
      { id: 'c1', partId: 'p1', name: 'Base', position: [0,0,0], rotationEuler: [0,0,0], fixed: true, color: '#999' },
      { id: 'c2', partId: 'p2', name: 'Top', position: [100,100,100], rotationEuler: [0,0,0], fixed: false, color: '#bbb' },
    ],
    [
      { id: 'm1', name: 'Mate1', type: 'coincident', componentAId: 'c1', faceAId: 3, componentBId: 'c2', faceBId: 2 },
    ],
    { p1: boxA, p2: boxB }
  );
  // c2 bottom face (y=0) should mate onto c1 top face (y=20)
  assert.ok(Math.abs(result[1].position[1] - 20) < 1e-3);
});

test('3D FEA mesher and linear static cantilever solver produce physically consistent deflection and Von Mises stress', () => {
  // Cantilever beam: 60mm along X, 15mm height (Y), 15mm width (Z)
  const beam = makeBoxTessellatedMesh(60, 15, 15);
  const grid = generateTetrahedralMesh(beam, 'coarse');
  assert.ok(grid.mesh.nodeCount > 20);
  assert.ok(grid.mesh.elementCount > 40);

  const steel = getMaterialById('structural_steel');
  const res = solveStaticFea(grid, beam, steel, {
    materialId: steel.id,
    meshResolution: 'coarse',
    supports: [{ id: 's1', name: 'Fixed', faceIds: [0], type: 'fixed' }], // x=0 face fixed
    loads: [{ id: 'l1', name: 'Force', faceIds: [1], type: 'force', magnitude: 1000, direction: [0, -1, 0], useFaceNormal: false }], // x=60 tip load -1000N
    resultMode: 'von_mises',
    deformationScale: 1,
  });

  // Analytical Euler-Bernoulli cantilever tip deflection: delta = F * L^3 / (3 * E * I)
  // L=60, b=15, h=15 -> I = 15^4 / 12 = 4218.75 mm^4, E = 200,000 MPa -> delta = 1000*216000 / (3*200000*4218.75) = 0.0853 mm
  // CST mesh is slightly stiffer, so expect ~0.04 to 0.14 mm
  assert.ok(res.maxDisplacement > 0.02 && res.maxDisplacement < 0.25, `Unexpected displacement: ${res.maxDisplacement}`);
  assert.ok(res.maxVonMises > 5 && res.maxVonMises < 150, `Unexpected Von Mises: ${res.maxVonMises}`);
  assert.ok(res.minSafetyFactor > 1);
  assert.equal(jetColor(0)[2], 0.5);
});

test('Selection filter routing, unique B-Rep vertex deduplication, and vertex distance calculation', () => {
  assert.deepEqual(getAllowedPickTargets('face'), {
    allowFace: true,
    allowEdge: false,
    allowVertex: false,
  });
  assert.deepEqual(getAllowedPickTargets('edge'), {
    allowFace: false,
    allowEdge: true,
    allowVertex: false,
  });
  assert.deepEqual(getAllowedPickTargets('vertex'), {
    allowFace: false,
    allowEdge: false,
    allowVertex: true,
  });

  const { vertexPositions, vertexInfos } = extractUniqueVertices([
    [0, 0, 0],
    [0.0001, 0, 0],
    [30, 40, 0],
    [30, 40, 0],
  ]);
  assert.equal(vertexInfos.length, 2);
  assert.equal(vertexPositions.length, 6);
  assert.ok(
    Math.abs(distanceBetweenPoints(vertexInfos[0].position, vertexInfos[1].position) - 50) < 1e-3
  );

  let sel = toggleSelectionId([], 4);
  sel = toggleSelectionId(sel, 7);
  assert.deepEqual(sel, [4, 7]);
  sel = toggleSelectionId(sel, 4);
  assert.deepEqual(sel, [7]);
});

test('Section View clipping plane spec, point filtering, and box cross-section contour generation', () => {
  // Cut at Z = 10 on a 40x20x20 box (keeps Z <= 10 by default)
  const plane = buildClippingPlaneSpec('z', 10, false);
  assert.deepEqual(plane.normal, [0, 0, -1]);
  assert.equal(plane.constant, 10);
  assert.equal(isPointKeptByPlane([20, 10, 5], plane), true);
  assert.equal(isPointKeptByPlane([20, 10, 15], plane), false);

  // Flipped plane keeps Z >= 10
  const flipped = buildClippingPlaneSpec('z', 10, true);
  assert.deepEqual(flipped.normal, [0, 0, 1]);
  assert.equal(isPointKeptByPlane([20, 10, 5], flipped), false);
  assert.equal(isPointKeptByPlane([20, 10, 15], flipped), true);

  // Slice through the box at Z = 10 -> 4 faces cross Z=10 -> generates contour segments at z=10
  const box = makeBoxTessellatedMesh(40, 20, 20);
  const segs = computeSectionContourSegments(box.positions, box.indices, plane);
  assert.ok(segs.length >= 6 * 4, `Expected cross-section segments, got ${segs.length}`);
  for (let i = 2; i < segs.length; i += 3) {
    assert.ok(Math.abs(segs[i] - 10) < 1e-4);
  }
});

test('Sketch solver handles parallel, perpendicular, equal, tangent and polygon/slot/spline loops', () => {
  const solved = solveSketchConstraints(
    [
      { id: 'a', type: 'line', x1: 0, y1: 0, x2: 30, y2: 0 },
      { id: 'b', type: 'line', x1: 10, y1: 10, x2: 20, y2: 25 },
      { id: 'c', type: 'line', x1: 50, y1: 0, x2: 65, y2: 10 },
      { id: 'c1', type: 'circle', cx: 0, cy: 20, radius: 5 },
    ],
    [
      { id: 'r1', type: 'parallel', entityAId: 'a', entityBId: 'b' },
      { id: 'r2', type: 'equal', entityAId: 'a', entityBId: 'b' },
      { id: 'r3', type: 'perpendicular', entityAId: 'a', entityBId: 'c' },
      { id: 'r4', type: 'tangent', entityAId: 'a', entityBId: 'c1' },
    ]
  );
  const lb = solved[1];
  const lc = solved[2];
  const circ = solved[3];
  if (lb.type === 'line' && lc.type === 'line' && circ.type === 'circle') {
    assert.ok(Math.abs(lb.y2 - lb.y1) < 0.01);
    assert.ok(Math.abs(Math.hypot(lb.x2 - lb.x1, lb.y2 - lb.y1) - 30) < 0.1);
    assert.ok(Math.abs(lc.x2 - lc.x1) < 0.01);
    assert.ok(Math.abs(Math.abs(circ.cy) - 5) < 0.1);
  }

  const loops = extractClosedLoops({
    id: 'sk_extra',
    name: 'Extra',
    planeId: 'front',
    entities: [
      { id: 'p1', type: 'polygon', cx: 0, cy: 0, radius: 12, sides: 6 },
      { id: 's1', type: 'slot', x1: 20, y1: 0, x2: 50, y2: 0, radius: 5 },
      { id: 'sp1', type: 'spline', points: [[0, 30], [15, 45], [30, 30], [15, 20]], closed: true },
    ],
    constraints: [],
  });
  assert.equal(loops.length, 3);
  assert.equal(loops[0].polygon.length, 6);
});

test('Sketch modify tools (offset, mirror, linear/circular pattern, trim) produce valid entities', () => {
  const off = offsetSketchEntity({ id: 'c', type: 'circle', cx: 10, cy: 10, radius: 8 }, 4);
  assert.ok(off && off.type === 'circle' && off.radius === 12);

  const mir = mirrorSketchEntity({ id: 'l', type: 'line', x1: 10, y1: 5, x2: 20, y2: 15 }, 'y');
  assert.ok(mir.type === 'line' && mir.x1 === -10 && mir.x2 === -20);

  const lpat = linearPatternSketchEntity({ id: 'c', type: 'circle', cx: 0, cy: 0, radius: 5 }, 3, 20);
  assert.equal(lpat.length, 2);

  const cpat = circularPatternSketchEntity({ id: 'c', type: 'circle', cx: 20, cy: 0, radius: 4 }, 4, 360, 0, 0);
  assert.equal(cpat.length, 3);

  const trimmed = trimSketchEntityAtPoint(
    [
      { id: 'l1', type: 'line', x1: 0, y1: 10, x2: 40, y2: 10 },
      { id: 'l2', type: 'line', x1: 20, y1: 0, x2: 20, y2: 20 },
    ],
    35,
    10,
    5
  );
  assert.equal(trimmed.length, 2);
  if (trimmed[0].type === 'line') {
    assert.ok(Math.abs(trimmed[0].x2 - 20) < 0.01);
  }
});

test('Assembly solver resolves parallel and angle mates accurately', () => {
  const boxA = makeBoxTessellatedMesh(20, 20, 20);
  const boxB = makeBoxTessellatedMesh(20, 20, 20);
  const solved = solveAssemblyMates(
    [
      { id: 'a', partId: 'pa', name: 'A', position: [0,0,0], rotationEuler: [0,0,0], fixed: true, color: '#999' },
      { id: 'b', partId: 'pb', name: 'B', position: [30,0,0], rotationEuler: [0,0,0], fixed: false, color: '#bbb' },
    ],
    [
      { id: 'm1', name: 'Angle45', type: 'angle', componentAId: 'a', faceAId: 3, componentBId: 'b', faceBId: 3, angleValue: 45 },
    ],
    { pa: boxA, pb: boxB }
  );
  const rotMag = Math.hypot(...solved[1].rotationEuler);
  assert.ok(Math.abs(rotMag - 45) < 1, `Expected ~45 deg tilt, got ${rotMag}`);
});

test('Evaluate utils compute exact moments of inertia, interference detection, exploded positions, and face angles', () => {
  // Analytical box mass & inertia: 40 x 20 x 20 mm, density 7850 kg/m^3 -> m = 0.1256 kg
  // Ixx = 1/12 * m * (20^2 + 20^2) = 8.373 kg*mm^2
  const box = makeBoxTessellatedMesh(40, 20, 20);
  const inertia = computeMomentsOfInertia(box.positions, box.indices, box.centerOfMass, 7850);
  assert.ok(Math.abs(inertia.Ixx - 8.373) < 0.2, `Unexpected Ixx: ${inertia.Ixx}`);
  assert.ok(inertia.Iyy > inertia.Ixx);

  // Interference detection: overlapping vs separated
  const compFixed = { id: 'c1', partId: 'p1', name: 'A', position: [0,0,0] as [number,number,number], rotationEuler: [0,0,0] as [number,number,number], fixed: true, color: '#999' };
  const compOverlap = { id: 'c2', partId: 'p1', name: 'B', position: [10,0,0] as [number,number,number], rotationEuler: [0,0,0] as [number,number,number], fixed: false, color: '#bbb' };
  const compClear = { id: 'c2', partId: 'p1', name: 'B', position: [60,0,0] as [number,number,number], rotationEuler: [0,0,0] as [number,number,number], fixed: false, color: '#bbb' };

  const hits = detectAssemblyInterference([compFixed, compOverlap], { p1: box });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].overlapVolumeCm3 > 1);

  const clean = detectAssemblyInterference([compFixed, compClear], { p1: box });
  assert.equal(clean.length, 0);

  // Exploded view pushes components apart
  const exploded = computeExplodedComponents([compFixed, compClear], { p1: box }, 1.0);
  assert.ok(exploded[1].position[0] > compClear.position[0]);

  // 90 deg angle between +X face (1) and +Y face (3)
  assert.ok(Math.abs(measureFacesAngleDeg(box.faceInfos[1], box.faceInfos[3]) - 90) < 0.01);
});

