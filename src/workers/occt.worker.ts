import initOpenCascade, { OpenCascadeInstance } from 'replicad-opencascadejs';
import occtWasmUrl from 'replicad-opencascadejs/wasm?url';
import {
  CadFeature,
  EdgeInfo,
  FaceInfo,
  GeometryCheckResult,
  PartDefinition,
  PlaneDefinition,
  SerializedTriangleSoup,
  SketchData,
  TessellatedMesh,
} from '../types/cad';
import {
  extractClosedLoops,
  resolvePlane,
  sampleSplinePoints,
  sketch2DTo3D,
} from '../utils/sketchSolver';
import { extractUniqueVertices } from '../utils/selectionUtils';

let ocInstance: OpenCascadeInstance | null = null;
let ocInitPromise: Promise<OpenCascadeInstance> | null = null;

async function getOc(): Promise<OpenCascadeInstance> {
  if (ocInstance) return ocInstance;
  if (!ocInitPromise) {
    ocInitPromise = initOpenCascade({
      locateFile: (file: string) => {
        if (file.endsWith('.wasm')) return occtWasmUrl;
        return file;
      },
    }).then((oc) => {
      ocInstance = oc;
      return oc;
    });
  }
  return ocInitPromise;
}

function fuseShapes(oc: OpenCascadeInstance, base: any, tool: any): any {
  if (!base) return tool;
  if (!tool) return base;
  try {
    const fuse = new oc.BRepAlgoAPI_Fuse(base, tool);
    fuse.Build(new oc.Message_ProgressRange());
    if (fuse.IsDone()) return fuse.Shape();
  } catch {
    // Keep base if boolean fails
  }
  return base;
}

function cutShapes(oc: OpenCascadeInstance, base: any, tool: any): any {
  if (!base) return null;
  if (!tool) return base;
  try {
    const cut = new oc.BRepAlgoAPI_Cut(base, tool);
    cut.Build(new oc.Message_ProgressRange());
    if (cut.IsDone()) return cut.Shape();
  } catch {
    // Keep base if boolean fails
  }
  return base;
}

function commonShapes(oc: OpenCascadeInstance, base: any, tool: any): any {
  if (!base || !tool) return base;
  try {
    const common = new oc.BRepAlgoAPI_Common(base, tool);
    common.Build(new oc.Message_ProgressRange());
    if (common.IsDone()) return common.Shape();
  } catch {
    // Keep base if boolean fails
  }
  return base;
}

function buildWiresAndFacesFromSketch(
  oc: OpenCascadeInstance,
  sketch: SketchData
): { wires: any[]; faces: any[]; plane: PlaneDefinition } {
  const plane = resolvePlane(sketch.planeId, sketch.planeOffset ?? 0, sketch.customPlane);
  const loops = extractClosedLoops(sketch);
  const wires: any[] = [];
  const faces: any[] = [];

  for (const loop of loops) {
    try {
      if (loop.isCircle && loop.circle) {
        const center3D = sketch2DTo3D(loop.circle.cx, loop.circle.cy, plane);
        const ax2 = new oc.gp_Ax2(
          new oc.gp_Pnt(center3D[0], center3D[1], center3D[2]),
          new oc.gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]),
          new oc.gp_Dir(plane.uAxis[0], plane.uAxis[1], plane.uAxis[2])
        );
        const circ = new oc.gp_Circ(ax2, loop.circle.radius);
        const edge = new oc.BRepBuilderAPI_MakeEdge(circ).Edge();
        const wire = new oc.BRepBuilderAPI_MakeWire(edge).Wire();
        const face = new oc.BRepBuilderAPI_MakeFace(wire, true).Face();
        wires.push(wire);
        faces.push(face);
        continue;
      }

      const wireBuilder = new oc.BRepBuilderAPI_MakeWire();
      let segCount = 0;
      for (const seg of loop.segments) {
        if (seg.kind === 'line') {
          const p1 = sketch2DTo3D(seg.x1, seg.y1, plane);
          const p2 = sketch2DTo3D(seg.x2, seg.y2, plane);
          if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) < 1e-5) continue;
          const edge = new oc.BRepBuilderAPI_MakeEdge(
            new oc.gp_Pnt(p1[0], p1[1], p1[2]),
            new oc.gp_Pnt(p2[0], p2[1], p2[2])
          ).Edge();
          wireBuilder.Add(edge);
          segCount++;
        } else if (
          seg.kind === 'arc' &&
          seg.cx !== undefined &&
          seg.cy !== undefined &&
          seg.radius !== undefined &&
          seg.startAngle !== undefined &&
          seg.endAngle !== undefined
        ) {
          const midA = (seg.startAngle + seg.endAngle) * 0.5;
          const p1 = sketch2DTo3D(seg.x1, seg.y1, plane);
          const pm = sketch2DTo3D(
            seg.cx + seg.radius * Math.cos(midA),
            seg.cy + seg.radius * Math.sin(midA),
            plane
          );
          const p2 = sketch2DTo3D(seg.x2, seg.y2, plane);
          const arcMaker = new oc.GC_MakeArcOfCircle(
            new oc.gp_Pnt(p1[0], p1[1], p1[2]),
            new oc.gp_Pnt(pm[0], pm[1], pm[2]),
            new oc.gp_Pnt(p2[0], p2[1], p2[2])
          );
          if (arcMaker.IsDone()) {
            const edge = new oc.BRepBuilderAPI_MakeEdge(arcMaker.Value()).Edge();
            wireBuilder.Add(edge);
            segCount++;
          }
        }
      }

      if (segCount >= 2 && wireBuilder.IsDone()) {
        const wire = wireBuilder.Wire();
        wires.push(wire);
        const faceMaker = new oc.BRepBuilderAPI_MakeFace(wire, true);
        if (faceMaker.IsDone()) {
          faces.push(faceMaker.Face());
        }
      }
    } catch {
      // Skip invalid loop
    }
  }

  return { wires, faces, plane };
}

function buildOpenPathWireFromSketch(
  oc: OpenCascadeInstance,
  sketch: SketchData
): any | null {
  const plane = resolvePlane(sketch.planeId, sketch.planeOffset ?? 0, sketch.customPlane);
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire();
  let added = 0;

  for (const ent of sketch.entities) {
    if (ent.type === 'line') {
      const p1 = sketch2DTo3D(ent.x1, ent.y1, plane);
      const p2 = sketch2DTo3D(ent.x2, ent.y2, plane);
      if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) > 1e-4) {
        const edge = new oc.BRepBuilderAPI_MakeEdge(
          new oc.gp_Pnt(p1[0], p1[1], p1[2]),
          new oc.gp_Pnt(p2[0], p2[1], p2[2])
        ).Edge();
        wireBuilder.Add(edge);
        added++;
      }
    } else if (ent.type === 'spline' && ent.points.length >= 2) {
      const pts = sampleSplinePoints(ent.points, Boolean(ent.closed), 6);
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = sketch2DTo3D(pts[i][0], pts[i][1], plane);
        const p2 = sketch2DTo3D(pts[i + 1][0], pts[i + 1][1], plane);
        if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) > 1e-4) {
          const edge = new oc.BRepBuilderAPI_MakeEdge(
            new oc.gp_Pnt(p1[0], p1[1], p1[2]),
            new oc.gp_Pnt(p2[0], p2[1], p2[2])
          ).Edge();
          wireBuilder.Add(edge);
          added++;
        }
      }
    }
  }

  if (added > 0 && wireBuilder.IsDone()) {
    return wireBuilder.Wire();
  }
  const { wires } = buildWiresAndFacesFromSketch(oc, sketch);
  return wires[0] ?? null;
}

function applyDraftToShape(
  oc: OpenCascadeInstance,
  shape: any,
  angleDeg: number,
  axisVec: [number, number, number]
): any {
  const rad = (angleDeg * Math.PI) / 180;
  if (Math.abs(rad) < 1e-4) return shape;

  try {
    const draft = new oc.BRepOffsetAPI_DraftAngle(shape);
    const pullDir = new oc.gp_Dir(axisVec[0], axisVec[1], axisVec[2]);
    const neutralPln = new oc.gp_Pln(new oc.gp_Pnt(0, 0, 0), pullDir);

    const exp = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    let addedAny = false;
    while (exp.More()) {
      const face = oc.TopoDS.Face(exp.Current());
      try {
        const surf = new oc.BRepAdaptor_Surface(face, true);
        if (surf.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
          const plnDir = surf.Plane().Axis().Direction();
          const dot =
            plnDir.X() * axisVec[0] + plnDir.Y() * axisVec[1] + plnDir.Z() * axisVec[2];
          // Side faces nearly perpendicular to pull direction
          if (Math.abs(dot) < 0.25) {
            draft.Add(face, pullDir, rad, neutralPln, true);
            if (draft.AddDone()) {
              addedAny = true;
            } else {
              draft.Remove(face);
            }
          }
        }
      } catch {
        // Ignore non-draftable face
      }
      exp.Next();
    }

    if (addedAny) {
      draft.Build(new oc.Message_ProgressRange());
      if (draft.IsDone()) return draft.Shape();
    }
  } catch {
    // Keep original shape if draft algorithm rejects
  }
  return shape;
}

function makePrismFromSketch(
  oc: OpenCascadeInstance,
  sketch: SketchData,
  depth: number,
  symmetric: boolean,
  direction: 1 | -1,
  draftExtrudeDeg = 0
): any | null {
  const { faces, plane } = buildWiresAndFacesFromSketch(oc, sketch);
  if (faces.length === 0) return null;

  const absDepth = Math.max(0.1, Math.abs(depth));
  const dirSign = direction >= 0 ? 1 : -1;
  const nx = plane.normal[0] * dirSign;
  const ny = plane.normal[1] * dirSign;
  const nz = plane.normal[2] * dirSign;

  let combined: any = null;
  for (const f of faces) {
    let baseShape = f;
    if (symmetric) {
      const tr = new oc.gp_Trsf();
      tr.SetTranslation(
        new oc.gp_Vec(-nx * absDepth * 0.5, -ny * absDepth * 0.5, -nz * absDepth * 0.5)
      );
      baseShape = new oc.BRepBuilderAPI_Transform(f, tr, true).Shape();
    }
    const prism = new oc.BRepPrimAPI_MakePrism(
      baseShape,
      new oc.gp_Vec(nx * absDepth, ny * absDepth, nz * absDepth),
      false,
      true
    );
    if (!prism.IsDone()) continue;
    let solid = prism.Shape();
    if (Math.abs(draftExtrudeDeg) > 0.1) {
      solid = applyDraftToShape(oc, solid, draftExtrudeDeg, [nx, ny, nz]);
    }
    combined = fuseShapes(oc, combined, solid);
  }
  return combined;
}

function makeRevolveFromSketch(
  oc: OpenCascadeInstance,
  sketch: SketchData,
  angleDeg: number,
  axisChoice: 'x' | 'y'
): any | null {
  const { faces, plane } = buildWiresAndFacesFromSketch(oc, sketch);
  if (faces.length === 0) return null;

  const axisDir =
    axisChoice === 'x'
      ? new oc.gp_Dir(plane.uAxis[0], plane.uAxis[1], plane.uAxis[2])
      : new oc.gp_Dir(plane.vAxis[0], plane.vAxis[1], plane.vAxis[2]);
  const ax1 = new oc.gp_Ax1(
    new oc.gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]),
    axisDir
  );
  const rad = Math.max(0.05, Math.min(Math.PI * 2, (Math.abs(angleDeg) * Math.PI) / 180));

  let combined: any = null;
  for (const f of faces) {
    const revol = new oc.BRepPrimAPI_MakeRevol(f, ax1, rad, false);
    if (!revol.IsDone()) continue;
    combined = fuseShapes(oc, combined, revol.Shape());
  }
  return combined;
}

function makeSweepFromFeature(
  oc: OpenCascadeInstance,
  feat: CadFeature,
  sketchMap: Map<string, SketchData>
): any | null {
  const profSketch = feat.sketchId ? sketchMap.get(feat.sketchId) : undefined;
  const pathSketch = feat.pathSketchId ? sketchMap.get(feat.pathSketchId) : undefined;
  if (!profSketch) return null;

  const { faces, plane } = buildWiresAndFacesFromSketch(oc, profSketch);
  if (faces.length === 0) return null;

  let spineWire = pathSketch ? buildOpenPathWireFromSketch(oc, pathSketch) : null;
  if (!spineWire) {
    // Fallback parametric curved path starting at profile origin along plane normal
    const p0 = new oc.gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]);
    const p1 = new oc.gp_Pnt(
      plane.origin[0] + plane.normal[0] * 35 + plane.uAxis[0] * 12,
      plane.origin[1] + plane.normal[1] * 35 + plane.uAxis[1] * 12,
      plane.origin[2] + plane.normal[2] * 35 + plane.uAxis[2] * 12
    );
    const e1 = new oc.BRepBuilderAPI_MakeEdge(p0, p1).Edge();
    spineWire = new oc.BRepBuilderAPI_MakeWire(e1).Wire();
  }

  try {
    const pipe = new oc.BRepOffsetAPI_MakePipe(spineWire, faces[0]);
    pipe.Build(new oc.Message_ProgressRange());
    if (pipe.IsDone()) return pipe.Shape();
  } catch {
    // Fallback to prism if non-G1 wire fails
  }
  return makePrismFromSketch(oc, profSketch, feat.depth ?? 30, false, 1);
}

function makeLoftFromFeature(
  oc: OpenCascadeInstance,
  feat: CadFeature,
  sketchMap: Map<string, SketchData>
): any | null {
  const ids = feat.profileSketchIds && feat.profileSketchIds.length >= 2
    ? feat.profileSketchIds
    : feat.sketchId
    ? [feat.sketchId]
    : [];

  const wires: any[] = [];
  let firstPlane: PlaneDefinition | null = null;
  for (const id of ids) {
    const sk = sketchMap.get(id);
    if (!sk) continue;
    const { wires: ws, plane } = buildWiresAndFacesFromSketch(oc, sk);
    if (!firstPlane) firstPlane = plane;
    if (ws[0]) wires.push(ws[0]);
  }

  if (wires.length === 1 && firstPlane) {
    // Synthesize second scaled + offset wire so single-sketch Loft produces valid tapered solid
    const tr = new oc.gp_Trsf();
    tr.SetTranslation(
      new oc.gp_Vec(
        firstPlane.normal[0] * 32,
        firstPlane.normal[1] * 32,
        firstPlane.normal[2] * 32
      )
    );
    const trScale = new oc.gp_Trsf();
    trScale.SetScale(
      new oc.gp_Pnt(firstPlane.origin[0], firstPlane.origin[1], firstPlane.origin[2]),
      0.65
    );
    const scaled = new oc.BRepBuilderAPI_Transform(wires[0], trScale, true).Shape();
    const moved = new oc.BRepBuilderAPI_Transform(scaled, tr, true).Shape();
    wires.push(oc.TopoDS.Wire(moved));
  }

  if (wires.length < 2) return null;

  try {
    const thru = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-3);
    thru.CheckCompatibility(true);
    for (const w of wires) {
      thru.AddWire(w);
    }
    thru.Build(new oc.Message_ProgressRange());
    if (thru.IsDone()) return thru.Shape();
  } catch {
    // Fallback ignored
  }
  return null;
}

function makeHoleWizardTool(oc: OpenCascadeInstance, feat: CadFeature): any | null {
  const diam = Math.max(1, feat.holeDiameter ?? 10);
  const r = diam * 0.5;
  const depth = Math.max(2, feat.holeDepth ?? 30);
  const hx = feat.holeX ?? 45;
  const hy = feat.holeY ?? 18;
  const hz = feat.holeZ ?? 0;
  const axis = feat.holeAxis ?? 'y';

  // Direction points INTO material (-axis) from top surface
  const dirVec: [number, number, number] =
    axis === 'x' ? [-1, 0, 0] : axis === 'z' ? [0, 0, -1] : [0, -1, 0];
  const ax2 = new oc.gp_Ax2(
    new oc.gp_Pnt(hx - dirVec[0] * 1, hy - dirVec[1] * 1, hz - dirVec[2] * 1),
    new oc.gp_Dir(dirVec[0], dirVec[1], dirVec[2])
  );

  let tool: any = new oc.BRepPrimAPI_MakeCylinder(ax2, r, depth + 2).Shape();

  if (feat.holeStandard === 'counterbore') {
    const cbR = Math.max(r + 0.5, (feat.cboreDiameter ?? diam * 1.8) * 0.5);
    const cbDepth = Math.max(1, feat.cboreDepth ?? 5);
    const cbCyl = new oc.BRepPrimAPI_MakeCylinder(ax2, cbR, cbDepth + 1).Shape();
    tool = fuseShapes(oc, tool, cbCyl);
  } else if (feat.holeStandard === 'countersink') {
    const csR = Math.max(r + 0.5, (feat.csinkDiameter ?? diam * 1.8) * 0.5);
    const csDepth = Math.max(1, csR - r);
    try {
      const topAx = new oc.gp_Ax2(
        new oc.gp_Pnt(hx - dirVec[0] * 1, hy - dirVec[1] * 1, hz - dirVec[2] * 1),
        new oc.gp_Dir(dirVec[0], dirVec[1], dirVec[2])
      );
      const botAx = new oc.gp_Ax2(
        new oc.gp_Pnt(
          hx + dirVec[0] * csDepth,
          hy + dirVec[1] * csDepth,
          hz + dirVec[2] * csDepth
        ),
        new oc.gp_Dir(dirVec[0], dirVec[1], dirVec[2])
      );
      const wTop = new oc.BRepBuilderAPI_MakeWire(
        new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(topAx, csR)).Edge()
      ).Wire();
      const wBot = new oc.BRepBuilderAPI_MakeWire(
        new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(botAx, r)).Edge()
      ).Wire();
      const cone = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-3);
      cone.AddWire(wTop);
      cone.AddWire(wBot);
      cone.Build(new oc.Message_ProgressRange());
      if (cone.IsDone()) {
        tool = fuseShapes(oc, tool, cone.Shape());
      }
    } catch {
      // Fallback to shaft cylinder
    }
  }

  return tool;
}

function applyShellToShape(
  oc: OpenCascadeInstance,
  shape: any,
  feat: CadFeature
): any {
  const thickness = Math.max(0.5, feat.thickness ?? 2.5);
  const offset = feat.shellOutward ? thickness : -thickness;
  const openSet = new Set(feat.openFaceIds ?? []);

  const allFaces: Array<{ id: number; face: any; area: number; topY: number }> = [];
  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  let idx = 0;
  while (exp.More()) {
    const face = oc.TopoDS.Face(exp.Current());
    let area = 0;
    let topY = -Infinity;
    try {
      const sProps = new oc.GProp_GProps();
      oc.BRepGProp.SurfaceProperties(face, sProps, false, false);
      area = Math.abs(sProps.Mass());
      topY = sProps.CentreOfMass().Y();
    } catch {
      // Ignore
    }
    allFaces.push({ id: idx, face, area, topY });
    idx++;
    exp.Next();
  }

  if (allFaces.length === 0) return shape;

  const list = new oc.NCollection_List_TopoDS_Shape();
  if (openSet.size > 0) {
    for (const f of allFaces) {
      if (openSet.has(f.id)) list.Append(f.face);
    }
  } else {
    // Pick highest Y face (or largest face) as default open shell face
    const sorted = [...allFaces].sort((a, b) => b.topY - a.topY || b.area - a.area);
    list.Append(sorted[0].face);
  }

  try {
    const thick = new oc.BRepOffsetAPI_MakeThickSolid();
    thick.MakeThickSolidByJoin(shape, list, offset, 1e-3);
    thick.Build(new oc.Message_ProgressRange());
    if (thick.IsDone()) return thick.Shape();
  } catch {
    // Keep original shape if thick solid rejects thin fillets
  }
  return shape;
}

function applyLinearPattern(
  oc: OpenCascadeInstance,
  baseShape: any,
  seedShape: any,
  feat: CadFeature
): any {
  const cx = Math.max(1, Math.min(8, Math.round(feat.patternCountX ?? 3)));
  const cy = Math.max(1, Math.min(6, Math.round(feat.patternCountY ?? 1)));
  const sx = feat.patternSpacingX ?? 35;
  const sy = feat.patternSpacingY ?? 30;
  const target = seedShape ?? baseShape;
  if (!target) return baseShape;

  let out = baseShape;
  for (let iy = 0; iy < cy; iy++) {
    for (let ix = 0; ix < cx; ix++) {
      if (ix === 0 && iy === 0) continue;
      const tr = new oc.gp_Trsf();
      tr.SetTranslation(new oc.gp_Vec(ix * sx, 0, iy * sy));
      const copy = new oc.BRepBuilderAPI_Transform(target, tr, true).Shape();
      out = fuseShapes(oc, out, copy);
    }
  }
  return out;
}

function applyCircularPattern(
  oc: OpenCascadeInstance,
  baseShape: any,
  seedShape: any,
  feat: CadFeature
): any {
  const count = Math.max(2, Math.min(16, Math.round(feat.circularCount ?? 4)));
  const totalDeg = Math.max(10, Math.min(360, feat.circularAngleDeg ?? 360));
  const full = Math.abs(totalDeg - 360) < 1e-2;
  const stepRad = ((full ? 360 / count : totalDeg / (count - 1)) * Math.PI) / 180;
  const axisChoice = feat.patternAxis ?? 'y';
  const dir =
    axisChoice === 'x'
      ? new oc.gp_Dir(1, 0, 0)
      : axisChoice === 'z'
      ? new oc.gp_Dir(0, 0, 1)
      : new oc.gp_Dir(0, 1, 0);
  const ax1 = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), dir);

  const target = seedShape ?? baseShape;
  if (!target) return baseShape;

  let out = baseShape;
  for (let i = 1; i < count; i++) {
    const tr = new oc.gp_Trsf();
    tr.SetRotation(ax1, stepRad * i);
    const copy = new oc.BRepBuilderAPI_Transform(target, tr, true).Shape();
    out = fuseShapes(oc, out, copy);
  }
  return out;
}

function applyMirrorFeature(
  oc: OpenCascadeInstance,
  shape: any,
  feat: CadFeature
): any {
  const mp = feat.mirrorPlane ?? 'right';
  const normal =
    mp === 'front'
      ? new oc.gp_Dir(0, 0, 1)
      : mp === 'top'
      ? new oc.gp_Dir(0, 1, 0)
      : new oc.gp_Dir(1, 0, 0);
  const ax2 = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), normal);
  const tr = new oc.gp_Trsf();
  tr.SetMirror(ax2);
  const mirrored = new oc.BRepBuilderAPI_Transform(shape, tr, true).Shape();
  return fuseShapes(oc, shape, mirrored);
}

function applyCombineFeature(
  oc: OpenCascadeInstance,
  baseShape: any,
  feat: CadFeature
): any {
  const prim = feat.combinePrimShape ?? 'cylinder';
  const [sx, sy, sz] = feat.combineSize ?? [24, 32, 24];
  const [ox, oy, oz] = feat.combineOffset ?? [45, 0, 0];

  let tool: any;
  if (prim === 'box') {
    tool = new oc.BRepPrimAPI_MakeBox(
      new oc.gp_Pnt(ox - sx * 0.5, oy, oz - sz * 0.5),
      Math.max(1, sx),
      Math.max(1, sy),
      Math.max(1, sz)
    ).Shape();
  } else if (prim === 'sphere') {
    tool = new oc.BRepPrimAPI_MakeSphere(
      new oc.gp_Pnt(ox, oy + sy * 0.5, oz),
      Math.max(1, sx * 0.5)
    ).Shape();
  } else {
    const ax2 = new oc.gp_Ax2(new oc.gp_Pnt(ox, oy, oz), new oc.gp_Dir(0, 1, 0));
    tool = new oc.BRepPrimAPI_MakeCylinder(
      ax2,
      Math.max(1, sx * 0.5),
      Math.max(1, sy)
    ).Shape();
  }

  if (!baseShape) return tool;
  const op = feat.combineOp ?? 'add';
  if (op === 'subtract') return cutShapes(oc, baseShape, tool);
  if (op === 'common') return commonShapes(oc, baseShape, tool);
  return fuseShapes(oc, baseShape, tool);
}

function selectTargetEdges(
  oc: OpenCascadeInstance,
  shape: any,
  feat: CadFeature
): any[] {
  const allEdges: Array<{
    edge: any;
    id: number;
    mid: [number, number, number];
    len: number;
  }> = [];

  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  let idx = 0;
  let maxY = -Infinity;
  while (exp.More()) {
    const edge = oc.TopoDS.Edge(exp.Current());
    try {
      const curve = new oc.BRepAdaptor_Curve(edge);
      const u0 = curve.FirstParameter();
      const u1 = curve.LastParameter();
      const p0 = curve.Value(u0);
      const pm = curve.Value((u0 + u1) * 0.5);
      const p1 = curve.Value(u1);
      const mx = pm.X(), my = pm.Y(), mz = pm.Z();
      const len = Math.hypot(p1.X() - p0.X(), p1.Y() - p0.Y(), p1.Z() - p0.Z());
      if (my > maxY) maxY = my;
      allEdges.push({ edge, id: idx, mid: [mx, my, mz], len });
    } catch {
      // Skip degenerate
    }
    idx++;
    exp.Next();
  }

  if (feat.edgeIds && feat.edgeIds.length > 0) {
    const set = new Set(feat.edgeIds);
    return allEdges.filter((e) => set.has(e.id)).map((e) => e.edge);
  }

  if (feat.edgePreset === 'inner_fillet') {
    const candidates = allEdges.filter(
      (e) =>
        e.len > 15 &&
        e.mid[0] > 5 &&
        e.mid[0] < 30 &&
        e.mid[1] > 5 &&
        e.mid[1] < 30 &&
        Math.abs(e.mid[2]) < 5
    );
    if (candidates.length > 0) return candidates.map((c) => c.edge);
  }

  if (feat.edgePreset === 'top_edges') {
    const candidates = allEdges.filter((e) => e.mid[1] > maxY - 1 && e.len > 2);
    if (candidates.length > 0) return candidates.map((c) => c.edge);
  }

  if (feat.edgePreset === 'all_edges') {
    return allEdges.slice(0, 12).map((e) => e.edge);
  }

  return allEdges.filter((e) => e.len > 5).slice(0, 2).map((e) => e.edge);
}

function applyFilletOrChamfer(
  oc: OpenCascadeInstance,
  shape: any,
  feat: CadFeature
): any {
  const edges = selectTargetEdges(oc, shape, feat);
  if (edges.length === 0) return shape;

  try {
    if (feat.type === 'fillet') {
      const r = Math.max(0.2, feat.radius ?? 3);
      const fillet = new oc.BRepFilletAPI_MakeFillet(
        shape,
        oc.ChFi3d_FilletShape.ChFi3d_Rational as any
      );
      for (const e of edges) fillet.Add(r, e);
      fillet.Build(new oc.Message_ProgressRange());
      if (fillet.IsDone()) return fillet.Shape();
    } else if (feat.type === 'chamfer') {
      const d = Math.max(0.2, feat.distance ?? 2);
      const chamfer = new oc.BRepFilletAPI_MakeChamfer(shape);
      for (const e of edges) chamfer.Add(d, e);
      chamfer.Build(new oc.Message_ProgressRange());
      if (chamfer.IsDone()) return chamfer.Shape();
    }
  } catch {
    // Graceful fallback if radius exceeds edge thickness
  }
  return shape;
}

function buildPartShape(oc: OpenCascadeInstance, part: PartDefinition): any | null {
  if (part.importedStepData) {
    const filename = `/tmp/import_${part.id}.step`;
    oc.FS.writeFile(filename, part.importedStepData);
    const reader = new oc.STEPControl_Reader();
    const status = reader.ReadFile(filename);
    if (status === oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      reader.TransferRoots(new oc.Message_ProgressRange());
      return reader.OneShape();
    }
  }

  const sketchMap = new Map<string, SketchData>();
  for (const s of part.sketches) sketchMap.set(s.id, s);

  let currentShape: any = null;
  let lastToolShape: any = null;

  for (const feat of part.features) {
    if (feat.suppressed) continue;

    if (feat.type === 'extrude_boss' && feat.sketchId) {
      const sk = sketchMap.get(feat.sketchId);
      if (!sk || sk.suppressed) continue;
      const tool = makePrismFromSketch(
        oc,
        sk,
        feat.depth ?? 20,
        Boolean(feat.symmetric),
        feat.direction ?? 1,
        feat.draftExtrudeDeg ?? 0
      );
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = fuseShapes(oc, currentShape, tool);
    } else if (feat.type === 'extrude_cut' && feat.sketchId && currentShape) {
      const sk = sketchMap.get(feat.sketchId);
      if (!sk || sk.suppressed) continue;
      const tool = makePrismFromSketch(
        oc,
        sk,
        feat.depth ?? 25,
        Boolean(feat.symmetric),
        feat.direction ?? -1
      );
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = cutShapes(oc, currentShape, tool);
    } else if (feat.type === 'revolve' && feat.sketchId) {
      const sk = sketchMap.get(feat.sketchId);
      if (!sk || sk.suppressed) continue;
      const tool = makeRevolveFromSketch(
        oc,
        sk,
        feat.angleDeg ?? 360,
        feat.revolveAxis ?? 'y'
      );
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = fuseShapes(oc, currentShape, tool);
    } else if (feat.type === 'revolve_cut' && feat.sketchId && currentShape) {
      const sk = sketchMap.get(feat.sketchId);
      if (!sk || sk.suppressed) continue;
      const tool = makeRevolveFromSketch(
        oc,
        sk,
        feat.angleDeg ?? 360,
        feat.revolveAxis ?? 'y'
      );
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = cutShapes(oc, currentShape, tool);
    } else if (feat.type === 'swept_boss') {
      const tool = makeSweepFromFeature(oc, feat, sketchMap);
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = fuseShapes(oc, currentShape, tool);
    } else if (feat.type === 'swept_cut' && currentShape) {
      const tool = makeSweepFromFeature(oc, feat, sketchMap);
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = cutShapes(oc, currentShape, tool);
    } else if (feat.type === 'loft_boss') {
      const tool = makeLoftFromFeature(oc, feat, sketchMap);
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = fuseShapes(oc, currentShape, tool);
    } else if (feat.type === 'hole_wizard' && currentShape) {
      const tool = makeHoleWizardTool(oc, feat);
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = cutShapes(oc, currentShape, tool);
    } else if ((feat.type === 'fillet' || feat.type === 'chamfer') && currentShape) {
      currentShape = applyFilletOrChamfer(oc, currentShape, feat);
    } else if (feat.type === 'shell' && currentShape) {
      currentShape = applyShellToShape(oc, currentShape, feat);
    } else if (feat.type === 'draft' && currentShape) {
      const da = feat.draftAxis ?? 'y';
      const vec: [number, number, number] =
        da === 'x' ? [1, 0, 0] : da === 'z' ? [0, 0, 1] : [0, 1, 0];
      currentShape = applyDraftToShape(oc, currentShape, feat.draftAngleDeg ?? 5, vec);
    } else if (feat.type === 'rib' && feat.sketchId) {
      const sk = sketchMap.get(feat.sketchId);
      if (!sk || sk.suppressed) continue;
      const tool = makePrismFromSketch(oc, sk, feat.ribThickness ?? 8, true, 1);
      if (!tool) continue;
      lastToolShape = tool;
      currentShape = fuseShapes(oc, currentShape, tool);
    } else if (feat.type === 'linear_pattern' && currentShape) {
      currentShape = applyLinearPattern(oc, currentShape, lastToolShape, feat);
    } else if (feat.type === 'circular_pattern' && currentShape) {
      currentShape = applyCircularPattern(oc, currentShape, lastToolShape, feat);
    } else if (feat.type === 'mirror' && currentShape) {
      currentShape = applyMirrorFeature(oc, currentShape, feat);
    } else if (feat.type === 'combine') {
      currentShape = applyCombineFeature(oc, currentShape, feat);
    }
  }

  return currentShape;
}

function tessellateShape(oc: OpenCascadeInstance, shape: any): TessellatedMesh {
  new oc.BRepMesh_IncrementalMesh(shape, 0.35, false, 0.35, true);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  const faceInfos: FaceInfo[] = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const faceExp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );

  let faceId = 0;
  while (faceExp.More()) {
    const face = oc.TopoDS.Face(faceExp.Current());
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);

    if (tri && (!tri.isNull || !tri.isNull()) && tri.NbNodes() > 0) {
      const trsf = loc.Transformation();
      const nbNodes = tri.NbNodes();
      const nbTris = tri.NbTriangles();
      const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const baseVertex = positions.length / 3;

      let cx = 0, cy = 0, cz = 0;
      for (let i = 1; i <= nbNodes; i++) {
        const p = tri.Node(i).Transformed(trsf);
        const x = p.X(), y = p.Y(), z = p.Z();
        positions.push(x, y, z);
        normals.push(0, 0, 0);
        cx += x; cy += y; cz += z;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }

      let faceArea = 0;
      let fnx = 0, fny = 0, fnz = 0;

      for (let t = 1; t <= nbTris; t++) {
        const polyTri = tri.Triangle(t);
        const n1 = polyTri.Value(1) - 1;
        const n2 = polyTri.Value(2) - 1;
        const n3 = polyTri.Value(3) - 1;

        const ia = baseVertex + n1;
        const ib = baseVertex + (reversed ? n3 : n2);
        const ic = baseVertex + (reversed ? n2 : n3);
        indices.push(ia, ib, ic);
        faceIds.push(faceId);

        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cxp = positions[ic * 3], cyp = positions[ic * 3 + 1], czp = positions[ic * 3 + 2];

        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cxp - ax, vy = cyp - ay, vz = czp - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const twoA = Math.hypot(nx, ny, nz);
        faceArea += 0.5 * twoA;
        fnx += nx; fny += ny; fnz += nz;

        for (const vi of [ia, ib, ic]) {
          normals[vi * 3] += nx;
          normals[vi * 3 + 1] += ny;
          normals[vi * 3 + 2] += nz;
        }
      }

      for (let i = baseVertex; i < baseVertex + nbNodes; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const len = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3] = nx / len;
        normals[i * 3 + 1] = ny / len;
        normals[i * 3 + 2] = nz / len;
      }

      const fnLen = Math.hypot(fnx, fny, fnz) || 1;
      let isCylindrical = false;
      let cylinderRadius: number | undefined;
      let cylinderAxis: [number, number, number] | undefined;
      try {
        const surf = new oc.BRepAdaptor_Surface(face, true);
        if (surf.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
          isCylindrical = true;
          const cyl = surf.Cylinder();
          cylinderRadius = cyl.Radius();
          const axisDir = cyl.Axis().Direction();
          cylinderAxis = [axisDir.X(), axisDir.Y(), axisDir.Z()];
        }
      } catch {
        // Ignore non-analytic surface metadata
      }

      faceInfos.push({
        faceId,
        center: [cx / Math.max(1, nbNodes), cy / Math.max(1, nbNodes), cz / Math.max(1, nbNodes)],
        normal: [fnx / fnLen, fny / fnLen, fnz / fnLen],
        area: faceArea,
        isCylindrical,
        cylinderRadius,
        cylinderAxis,
      });

      faceId++;
    }
    faceExp.Next();
  }

  // Extract sharp B-Rep edges
  const edgePositions: number[] = [];
  const edgeIds: number[] = [];
  const edgeInfos: EdgeInfo[] = [];

  const edgeExp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  let eId = 0;
  while (edgeExp.More()) {
    const edge = oc.TopoDS.Edge(edgeExp.Current());
    try {
      const curve = new oc.BRepAdaptor_Curve(edge);
      const u0 = curve.FirstParameter();
      const u1 = curve.LastParameter();
      if (Number.isFinite(u0) && Number.isFinite(u1) && Math.abs(u1 - u0) > 1e-6) {
        const isLine = curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
        const steps = isLine ? 1 : 20;
        let prev = curve.Value(u0);
        let len = 0;
        for (let s = 1; s <= steps; s++) {
          const u = u0 + ((u1 - u0) * s) / steps;
          const cur = curve.Value(u);
          edgePositions.push(prev.X(), prev.Y(), prev.Z(), cur.X(), cur.Y(), cur.Z());
          edgeIds.push(eId);
          len += Math.hypot(cur.X() - prev.X(), cur.Y() - prev.Y(), cur.Z() - prev.Z());
          prev = cur;
        }
        const pm = curve.Value((u0 + u1) * 0.5);
        const pStart = curve.Value(u0);
        const pEnd = curve.Value(u1);
        const tx = pEnd.X() - pStart.X();
        const ty = pEnd.Y() - pStart.Y();
        const tz = pEnd.Z() - pStart.Z();
        const tLen = Math.hypot(tx, ty, tz) || 1;
        edgeInfos.push({
          edgeId: eId,
          midpoint: [pm.X(), pm.Y(), pm.Z()],
          length: len,
          tangent: [tx / tLen, ty / tLen, tz / tLen],
        });
      }
    } catch {
      // Skip degenerate curve
    }
    eId++;
    edgeExp.Next();
  }

  // Extract unique B-Rep vertices
  const rawVertices: Array<[number, number, number]> = [];
  const vertExp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as any,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );
  while (vertExp.More()) {
    try {
      const v = oc.TopoDS.Vertex(vertExp.Current());
      const pnt = oc.BRep_Tool.Pnt(v);
      rawVertices.push([pnt.X(), pnt.Y(), pnt.Z()]);
    } catch {
      // Skip invalid vertex
    }
    vertExp.Next();
  }
  const { vertexPositions, vertexInfos } = extractUniqueVertices(rawVertices);

  // Mass properties via BRepGProp
  let volume = 0;
  let surfaceArea = 0;
  let centerOfMass: [number, number, number] = [0, 0, 0];
  try {
    const vProps = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, vProps, true, false, false);
    volume = Math.abs(vProps.Mass());
    const com = vProps.CentreOfMass();
    centerOfMass = [com.X(), com.Y(), com.Z()];

    const sProps = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(shape, sProps, false, false);
    surfaceArea = Math.abs(sProps.Mass());
  } catch {
    // Ignore
  }

  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 1;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceIds: new Int32Array(faceIds),
    edgePositions: new Float32Array(edgePositions),
    edgeIds: new Int32Array(edgeIds),
    vertexPositions,
    faceInfos,
    edgeInfos,
    vertexInfos,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
    volume,
    surfaceArea,
    centerOfMass,
    kernelSource: 'opencascade',
  };
}

function soupToTessellatedMesh(soup: SerializedTriangleSoup): TessellatedMesh {
  const positions = new Float32Array(soup.positions);
  const normals = new Float32Array(soup.normals);
  const indices = new Uint32Array(soup.indices);
  const triCount = indices.length / 3;
  const faceIds = new Int32Array(triCount);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let cx = 0, cy = 0, cz = 0;
  const vCount = positions.length / 3;

  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    cx += x; cy += y; cz += z;
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }

  const normalGroups = new Map<string, number>();
  let nextFaceId = 0;
  const faceAccums = new Map<
    number,
    { cx: number; cy: number; cz: number; nx: number; ny: number; nz: number; area: number; count: number }
  >();

  let surfaceArea = 0;
  let signedVol = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cxp = positions[ic], cyp = positions[ic + 1], czp = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cxp - ax, vy = cyp - ay, vz = czp - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const area = 0.5 * len;
    surfaceArea += area;
    signedVol +=
      (ax * (by * czp - bz * cyp) -
        ay * (bx * czp - bz * cxp) +
        az * (bx * cyp - by * cxp)) /
      6;

    const qx = Math.round((nx / len) * 4);
    const qy = Math.round((ny / len) * 4);
    const qz = Math.round((nz / len) * 4);
    const key = `${qx},${qy},${qz}`;
    let fId = normalGroups.get(key);
    if (fId === undefined) {
      fId = nextFaceId++;
      normalGroups.set(key, fId);
      faceAccums.set(fId, { cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, area: 0, count: 0 });
    }
    faceIds[t] = fId;
    const acc = faceAccums.get(fId)!;
    acc.cx += (ax + bx + cxp) / 3;
    acc.cy += (ay + by + cyp) / 3;
    acc.cz += (az + bz + czp) / 3;
    acc.nx += nx / len;
    acc.ny += ny / len;
    acc.nz += nz / len;
    acc.area += area;
    acc.count++;
  }

  const faceInfos: FaceInfo[] = [];
  for (const [fId, acc] of faceAccums) {
    const nLen = Math.hypot(acc.nx, acc.ny, acc.nz) || 1;
    faceInfos.push({
      faceId: fId,
      center: [acc.cx / acc.count, acc.cy / acc.count, acc.cz / acc.count],
      normal: [acc.nx / nLen, acc.ny / nLen, acc.nz / nLen],
      area: acc.area,
      isCylindrical: false,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 1;
  }

  const rawSoupVerts: Array<[number, number, number]> = [];
  for (let i = 0; i < vCount; i++) {
    rawSoupVerts.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  }
  const { vertexPositions, vertexInfos } = extractUniqueVertices(rawSoupVerts);

  return {
    positions,
    normals,
    indices,
    faceIds,
    edgePositions: new Float32Array(0),
    edgeIds: new Int32Array(0),
    vertexPositions,
    faceInfos,
    edgeInfos: [],
    vertexInfos,
    boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    volume: Math.abs(signedVol),
    surfaceArea,
    centerOfMass: vCount > 0 ? [cx / vCount, cy / vCount, cz / vCount] : [0, 0, 0],
    kernelSource: 'fallback',
  };
}

self.onmessage = async (event: MessageEvent) => {
  const { id, type, payload } = event.data;

  try {
    if (type === 'BUILD_PART') {
      const part: PartDefinition = payload.part;
      if (part.importedMesh && !part.importedStepData) {
        const mesh = soupToTessellatedMesh(part.importedMesh);
        self.postMessage({ id, ok: true, result: mesh });
        return;
      }

      const oc = await getOc();
      const shape = buildPartShape(oc, part);
      if (!shape) {
        self.postMessage({
          id,
          ok: true,
          result: soupToTessellatedMesh({ positions: [], normals: [], indices: [] }),
        });
        return;
      }
      const mesh = tessellateShape(oc, shape);
      self.postMessage({ id, ok: true, result: mesh });
    } else if (type === 'CHECK_GEOMETRY') {
      const part: PartDefinition = payload.part;
      const oc = await getOc();
      const shape = buildPartShape(oc, part);
      if (!shape) {
        const emptyRes: GeometryCheckResult = {
          isValid: false,
          faceCount: 0,
          edgeCount: 0,
          vertexCount: 0,
          triangleCount: 0,
          summary: 'Kontrol edilecek geçerli B-Rep katı gövde bulunamadı.',
        };
        self.postMessage({ id, ok: true, result: emptyRes });
        return;
      }
      const analyzer = new oc.BRepCheck_Analyzer(shape, true);
      const isValid = Boolean(analyzer.IsValid(shape));
      const mesh = tessellateShape(oc, shape);
      const res: GeometryCheckResult = {
        isValid,
        faceCount: mesh.faceInfos.length,
        edgeCount: mesh.edgeInfos.length,
        vertexCount: mesh.vertexInfos.length,
        triangleCount: mesh.indices.length / 3,
        summary: isValid
          ? 'OpenCascade B-Rep topoloji ve yüzey sürekliliği doğrulandı (0 hata).'
          : 'Uyarı: B-Rep gövde üzerinde geçersiz kenar veya öz-kesişim tespit edildi.',
      };
      self.postMessage({ id, ok: true, result: res });
    } else if (type === 'EXPORT_STEP') {
      const part: PartDefinition = payload.part;
      const oc = await getOc();
      const shape = buildPartShape(oc, part);
      if (!shape) throw new Error('STEP dışa aktarımı için geçerli 3D katı bulunamadı.');

      oc.Interface_Static.SetCVal('write.step.schema', 'AP214');
      const writer = new oc.STEPControl_Writer();
      writer.Transfer(
        shape,
        oc.STEPControl_StepModelType.STEPControl_AsIs as any,
        true,
        new oc.Message_ProgressRange()
      );
      const outPath = `/tmp/export_${part.id}.step`;
      writer.Write(outPath);
      const stepText = oc.FS.readFile(outPath, { encoding: 'utf8' });
      self.postMessage({ id, ok: true, result: stepText });
    } else if (type === 'EXPORT_STL_OCCT') {
      const part: PartDefinition = payload.part;
      const oc = await getOc();
      const shape = buildPartShape(oc, part);
      if (!shape) throw new Error('STL dışa aktarımı için geçerli 3D katı bulunamadı.');
      new oc.BRepMesh_IncrementalMesh(shape, 0.25, false, 0.25, true);
      const writer = new oc.StlAPI_Writer();
      const outPath = `/tmp/export_${part.id}.stl`;
      writer.Write(shape, outPath, new oc.Message_ProgressRange());
      const stlBytes = oc.FS.readFile(outPath);
      self.postMessage({ id, ok: true, result: stlBytes });
    } else if (type === 'IMPORT_STEP') {
      const stepText: string = payload.stepText;
      const oc = await getOc();
      const inPath = `/tmp/upload_${Date.now()}.step`;
      oc.FS.writeFile(inPath, stepText);
      const reader = new oc.STEPControl_Reader();
      const status = reader.ReadFile(inPath);
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
        throw new Error('STEP dosyası OpenCascade tarafından okunamadı.');
      }
      reader.TransferRoots(new oc.Message_ProgressRange());
      const shape = reader.OneShape();
      const mesh = tessellateShape(oc, shape);
      self.postMessage({ id, ok: true, result: mesh });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message ?? String(err),
    });
  }
};
