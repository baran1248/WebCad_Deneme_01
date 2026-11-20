import { CadProject, PlaneDefinition } from '../types/cad';

export const STANDARD_PLANES: Record<'front' | 'top' | 'right', PlaneDefinition> = {
  front: {
    id: 'front',
    name: 'Ön Düzlem (XY)',
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
  },
  top: {
    id: 'top',
    name: 'Üst Düzlem (XZ)',
    origin: [0, 0, 0],
    normal: [0, 1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, -1],
  },
  right: {
    id: 'right',
    name: 'Sağ Düzlem (YZ)',
    origin: [0, 0, 0],
    normal: [1, 0, 0],
    uAxis: [0, 0, -1],
    vAxis: [0, 1, 0],
  },
};

export function createDefaultProject(): CadProject {
  return {
    version: '1.0.0',
    name: 'Delikli_L_Braket_Montaji',
    activePartId: 'part_bracket',
    parts: [
      {
        id: 'part_bracket',
        name: 'Delikli_Braket',
        color: '#9aa5b4',
        sketches: [
          {
            id: 'sketch_l_profile',
            name: 'Sketch1 (L-Profil)',
            planeId: 'front',
            planeOffset: 0,
            // Closed L-bracket cross section in XY plane (mm)
            entities: [
              { id: 'e1', type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
              { id: 'e2', type: 'line', x1: 100, y1: 0, x2: 100, y2: 14 },
              { id: 'e3', type: 'line', x1: 100, y1: 14, x2: 14, y2: 14 },
              { id: 'e4', type: 'line', x1: 14, y1: 14, x2: 14, y2: 80 },
              { id: 'e5', type: 'line', x1: 14, y1: 80, x2: 0, y2: 80 },
              { id: 'e6', type: 'line', x1: 0, y1: 80, x2: 0, y2: 0 },
            ],
            constraints: [
              { id: 'c1', type: 'horizontal', entityId: 'e1' },
              { id: 'c2', type: 'vertical', entityId: 'e2' },
              { id: 'c3', type: 'horizontal', entityId: 'e3' },
              { id: 'c4', type: 'vertical', entityId: 'e4' },
              { id: 'c5', type: 'horizontal', entityId: 'e5' },
              { id: 'c6', type: 'vertical', entityId: 'e6' },
            ],
          },
          {
            id: 'sketch_base_holes',
            name: 'Sketch2 (Taban Delikleri)',
            planeId: 'top',
            planeOffset: 16,
            // Top plane: u = X, v = -Z
            entities: [
              { id: 'h1', type: 'circle', cx: 68, cy: 16, radius: 7.5 },
              { id: 'h2', type: 'circle', cx: 68, cy: -16, radius: 7.5 },
            ],
            constraints: [],
          },
          {
            id: 'sketch_wall_hole',
            name: 'Sketch3 (Dikey Mil Deliği)',
            planeId: 'right',
            planeOffset: 16,
            // Right plane: u = -Z, v = Y
            entities: [
              { id: 'h3', type: 'circle', cx: 0, cy: 50, radius: 11 },
            ],
            constraints: [],
          },
        ],
        features: [
          {
            id: 'feat_extrude_base',
            name: 'Boss-Extrude1 (Ana Gövde)',
            type: 'extrude_boss',
            sketchId: 'sketch_l_profile',
            depth: 60,
            symmetric: true,
            direction: 1,
          },
          {
            id: 'feat_cut_base_holes',
            name: 'Cut-Extrude1 (Taban Delikleri)',
            type: 'extrude_cut',
            sketchId: 'sketch_base_holes',
            depth: 22,
            symmetric: false,
            direction: -1,
          },
          {
            id: 'feat_cut_wall_hole',
            name: 'Cut-Extrude2 (Mil Yuvası)',
            type: 'extrude_cut',
            sketchId: 'sketch_wall_hole',
            depth: 22,
            symmetric: false,
            direction: -1,
          },
          {
            id: 'feat_fillet_inner',
            name: 'Fillet1 (İç Köşe Radyusu)',
            type: 'fillet',
            radius: 5,
            edgePreset: 'inner_fillet',
          },
        ],
      },
      {
        id: 'part_pin',
        name: 'Destek_Pimi',
        color: '#b89456',
        sketches: [
          {
            id: 'sketch_pin_profile',
            name: 'Sketch1 (Pim Kesiti)',
            planeId: 'right',
            planeOffset: 0,
            entities: [
              { id: 'p1', type: 'circle', cx: 0, cy: 0, radius: 10.8 },
            ],
            constraints: [],
          },
        ],
        features: [
          {
            id: 'feat_pin_extrude',
            name: 'Boss-Extrude1 (Pim Gövdesi)',
            type: 'extrude_boss',
            sketchId: 'sketch_pin_profile',
            depth: 38,
            symmetric: true,
            direction: 1,
          },
        ],
      },
    ],
    assemblyComponents: [
      {
        id: 'comp_bracket_1',
        partId: 'part_bracket',
        name: 'Delikli_Braket-1',
        position: [0, 0, 0],
        rotationEuler: [0, 0, 0],
        fixed: true,
        color: '#9aa5b4',
      },
    ],
    assemblyMates: [],
    fea: {
      materialId: 'structural_steel',
      meshResolution: 'medium',
      supports: [
        {
          id: 'sup_1',
          name: 'Fixed Support (Taban Yüzeyi)',
          faceIds: [], // Resolved dynamically on first load if empty (bottom Y=0 face)
          type: 'fixed',
        },
      ],
      loads: [
        {
          id: 'load_1',
          name: 'Force (Üst Flanş Yükü)',
          faceIds: [], // Resolved dynamically on first load if empty (top/end face)
          type: 'force',
          magnitude: 2500, // 2500 N
          direction: [0, -1, 0],
          useFaceNormal: false,
        },
      ],
      resultMode: 'von_mises',
      deformationScale: 1,
    },
    updatedAt: Date.now(),
  };
}
