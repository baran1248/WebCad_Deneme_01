export type CommandTab =
  | 'sketch'
  | 'features'
  | 'reference'
  | 'assembly'
  | 'evaluate'
  | 'fea';

export type PlaneId = 'front' | 'top' | 'right' | string;

export interface PlaneDefinition {
  id: PlaneId;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

export type SketchTool =
  | 'select'
  | 'line'
  | 'centerline'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'slot'
  | 'spline'
  | 'dimension'
  | 'trim';

export type SketchEntity =
  | {
      id: string;
      type: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      construction?: boolean;
    }
  | {
      id: string;
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      id: string;
      type: 'circle';
      cx: number;
      cy: number;
      radius: number;
    }
  | {
      id: string;
      type: 'arc';
      cx: number;
      cy: number;
      radius: number;
      startAngle: number; // radians
      endAngle: number; // radians
    }
  | {
      id: string;
      type: 'polygon';
      cx: number;
      cy: number;
      radius: number;
      sides: number;
    }
  | {
      id: string;
      type: 'slot';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      radius: number;
    }
  | {
      id: string;
      type: 'spline';
      points: Array<[number, number]>;
      closed?: boolean;
    };

export type SketchRelationType =
  | 'horizontal'
  | 'vertical'
  | 'coincident'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal';

export type SketchConstraint =
  | {
      id: string;
      type: 'horizontal' | 'vertical';
      entityId: string;
    }
  | {
      id: string;
      type: 'coincident';
      entityAId: string;
      pointA: 'start' | 'end' | 'center';
      entityBId: string;
      pointB: 'start' | 'end' | 'center';
    }
  | {
      id: string;
      type: 'parallel' | 'perpendicular' | 'tangent' | 'equal';
      entityAId: string;
      entityBId: string;
    }
  | {
      id: string;
      type: 'dimension';
      entityId: string;
      param: 'length' | 'width' | 'height' | 'radius' | 'diameter';
      value: number;
    };

export interface SketchData {
  id: string;
  name: string;
  planeId: PlaneId;
  planeOffset?: number;
  customPlane?: PlaneDefinition;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  suppressed?: boolean;
}

export type FeatureType =
  | 'extrude_boss'
  | 'extrude_cut'
  | 'revolve'
  | 'revolve_cut'
  | 'swept_boss'
  | 'swept_cut'
  | 'loft_boss'
  | 'hole_wizard'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'draft'
  | 'rib'
  | 'linear_pattern'
  | 'circular_pattern'
  | 'mirror'
  | 'combine';

export interface CadFeature {
  id: string;
  name: string;
  type: FeatureType;
  suppressed?: boolean;
  sketchId?: string;
  pathSketchId?: string;
  profileSketchIds?: string[];
  depth?: number;
  symmetric?: boolean;
  direction?: 1 | -1;
  draftExtrudeDeg?: number;
  angleDeg?: number;
  revolveAxis?: 'x' | 'y';
  radius?: number;
  distance?: number;
  edgeIds?: number[];
  edgePreset?: 'inner_fillet' | 'outer_edges' | 'top_edges' | 'all_edges';
  // Hole Wizard
  holeStandard?: 'counterbore' | 'countersink' | 'simple' | 'tapped';
  holeDiameter?: number;
  holeDepth?: number;
  cboreDiameter?: number;
  cboreDepth?: number;
  csinkDiameter?: number;
  holeX?: number;
  holeY?: number;
  holeZ?: number;
  holeAxis?: 'x' | 'y' | 'z';
  // Shell
  thickness?: number;
  shellOutward?: boolean;
  openFaceIds?: number[];
  // Draft
  draftAngleDeg?: number;
  draftAxis?: 'x' | 'y' | 'z';
  // Rib
  ribThickness?: number;
  // Patterns & Mirror
  patternCountX?: number;
  patternSpacingX?: number;
  patternCountY?: number;
  patternSpacingY?: number;
  circularCount?: number;
  circularAngleDeg?: number;
  patternAxis?: 'x' | 'y' | 'z';
  mirrorPlane?: 'front' | 'top' | 'right';
  // Combine
  combineOp?: 'add' | 'subtract' | 'common';
  combinePrimShape?: 'box' | 'cylinder' | 'sphere';
  combineSize?: [number, number, number];
  combineOffset?: [number, number, number];
}

export type ReferenceGeometryItem =
  | {
      id: string;
      name: string;
      kind: 'plane';
      basePlane: 'front' | 'top' | 'right';
      offset: number;
      angleDeg?: number;
    }
  | {
      id: string;
      name: string;
      kind: 'axis';
      origin: [number, number, number];
      direction: [number, number, number];
    }
  | {
      id: string;
      name: string;
      kind: 'point';
      position: [number, number, number];
    }
  | {
      id: string;
      name: string;
      kind: 'coord_sys';
      origin: [number, number, number];
      rotationEuler: [number, number, number];
    };

export interface ImportedSolid {
  id: string;
  name: string;
  format: 'step' | 'iges' | 'stl' | 'obj';
  rawData: string;
}

export interface PartDefinition {
  id: string;
  name: string;
  color: string;
  sketches: SketchData[];
  features: CadFeature[];
  referenceGeometries?: ReferenceGeometryItem[];
  importedMesh?: SerializedTriangleSoup;
  importedStepData?: string;
}

export interface SerializedTriangleSoup {
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface AssemblyComponent {
  id: string;
  partId: string;
  name: string;
  position: [number, number, number];
  rotationEuler: [number, number, number]; // degrees
  fixed?: boolean;
  color: string;
}

export type MateType =
  | 'coincident'
  | 'concentric'
  | 'distance'
  | 'parallel'
  | 'perpendicular'
  | 'angle';

export interface AssemblyMate {
  id: string;
  name: string;
  type: MateType;
  componentAId: string;
  faceAId: number;
  componentBId: string;
  faceBId: number;
  distanceValue?: number;
  angleValue?: number;
  flipNormal?: boolean;
}

export type EvaluateVisualMode = 'none' | 'draft_analysis' | 'curvature';

export interface GeometryCheckResult {
  isValid: boolean;
  faceCount: number;
  edgeCount: number;
  vertexCount: number;
  triangleCount: number;
  summary: string;
}

export interface InterferencePair {
  componentAName: string;
  componentBName: string;
  overlapVolumeCm3: number;
  overlapCenter: [number, number, number];
}

export interface MaterialDef {
  id: string;
  name: string;
  nameTr: string;
  elasticModulus: number; // Pa
  poissonRatio: number;
  yieldStrength: number; // Pa
  density: number; // kg/m^3
  color: string;
  metalness: number;
  roughness: number;
}

export interface FeaSupport {
  id: string;
  name: string;
  faceIds: number[];
  type: 'fixed';
}

export interface FeaLoad {
  id: string;
  name: string;
  faceIds: number[];
  type: 'force' | 'pressure';
  magnitude: number; // N for force, MPa for pressure
  direction: [number, number, number]; // unit vector or 'normal'
  useFaceNormal: boolean;
}

export interface FeaSettings {
  materialId: string;
  meshResolution: 'coarse' | 'medium' | 'fine';
  supports: FeaSupport[];
  loads: FeaLoad[];
  resultMode: 'von_mises' | 'displacement' | 'safety_factor';
  deformationScale: number; // 0 = undeformed, 1 = auto, etc.
}

export interface CadProject {
  version: string;
  name: string;
  activePartId: string;
  parts: PartDefinition[];
  assemblyComponents: AssemblyComponent[];
  assemblyMates: AssemblyMate[];
  fea: FeaSettings;
  updatedAt: number;
}

export interface FaceInfo {
  faceId: number;
  center: [number, number, number];
  normal: [number, number, number];
  area: number;
  isCylindrical: boolean;
  cylinderRadius?: number;
  cylinderAxis?: [number, number, number];
}

export type SelectionFilter = 'face' | 'edge' | 'vertex';

export type SectionAxis = 'x' | 'y' | 'z';

export interface SectionViewState {
  enabled: boolean;
  axis: SectionAxis;
  offset: number;
  flipped: boolean;
}

export interface EdgeInfo {
  edgeId: number;
  midpoint: [number, number, number];
  length: number;
  tangent: [number, number, number];
}

export interface VertexInfo {
  vertexId: number;
  position: [number, number, number];
}

export interface TessellatedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceIds: Int32Array; // per-triangle faceId
  edgePositions: Float32Array; // pairs of XYZ for LineSegments
  edgeIds: Int32Array; // per-segment edgeId
  vertexPositions: Float32Array; // unique B-Rep vertices (M * 3)
  faceInfos: FaceInfo[];
  edgeInfos: EdgeInfo[];
  vertexInfos: VertexInfo[];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  volume: number; // mm^3
  surfaceArea: number; // mm^2
  centerOfMass: [number, number, number];
  kernelSource: 'opencascade' | 'fallback';
}

export interface FeaMeshData {
  nodes: Float32Array; // N * 3
  tets: Uint32Array; // M * 4
  surfaceTriangles: Uint32Array; // K * 3 indices into nodes
  surfaceFaceIds: Int32Array; // K face ids
  nodeCount: number;
  elementCount: number;
}

export interface FeaResult {
  displacements: Float32Array; // per FEA node (3 components)
  nodeVonMises: Float32Array; // per FEA node (MPa)
  nodeDisplacementMag: Float32Array; // per FEA node (mm)
  vertexVonMises: Float32Array; // projected onto render mesh vertices (MPa)
  vertexDisplacement: Float32Array; // projected onto render mesh vertices (3 components, mm)
  vertexDisplacementMag: Float32Array; // projected onto render mesh vertices (mm)
  vertexSafetyFactor: Float32Array; // yield / vonMises
  maxVonMises: number; // MPa
  minVonMises: number; // MPa
  maxDisplacement: number; // mm
  minSafetyFactor: number;
  solveTimeMs: number;
  dofCount: number;
  elementCount: number;
}
