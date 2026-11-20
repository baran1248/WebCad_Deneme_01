import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AssemblyComponent,
  AssemblyMate,
  CadFeature,
  CadProject,
  CommandTab,
  EvaluateVisualMode,
  FeatureType,
  FeaMeshData,
  FeaResult,
  FeaSettings,
  GeometryCheckResult,
  InterferencePair,
  MateType,
  PartDefinition,
  PlaneId,
  ReferenceGeometryItem,
  SectionViewState,
  SelectionFilter,
  SketchData,
  SketchEntity,
  SketchRelationType,
  SketchTool,
  TessellatedMesh,
} from './types/cad';
import { toggleSelectionId } from './utils/selectionUtils';
import { createDefaultProject } from './data/defaultProject';
import { getMaterialById } from './data/materials';
import { solveAssemblyMates } from './utils/assemblySolver';
import { resolvePlane } from './utils/sketchSolver';
import {
  circularPatternSketchEntity,
  convertEdgeToSketchEntity,
  linearPatternSketchEntity,
  mirrorSketchEntity,
  offsetSketchEntity,
  trimSketchEntityAtPoint,
} from './utils/sketchModify';
import {
  computeExplodedComponents,
  detectAssemblyInterference,
} from './utils/evaluateUtils';
import {
  exportMeshToIGES,
  exportMeshToOBJ,
  exportMeshToSTL,
  parseIGES,
  parseMcadJson,
  parseOBJ,
  parseSTL,
  serializeProjectToMcadJson,
} from './utils/cadFormats';
import {
  loadProjectFromIndexedDb,
  saveProjectToIndexedDb,
} from './utils/indexedDb';
import {
  buildPartInWorker,
  checkGeometryInWorker,
  exportStepInWorker,
  generateFeaMeshInWorker,
  importStepInWorker,
  solveFeaInWorker,
} from './utils/workerClient';
import {
  AssemblyToolPanel,
  CommandManager,
  EvaluateToolPanel,
  SketchModifyAction,
} from './components/CommandManager';
import { FeatureTree, SelectedTreeItem } from './components/FeatureTree';
import {
  ActiveFeatureDraft,
  ActiveMateDraft,
  PropertyPanel,
} from './components/PropertyPanel';
import { CadViewport } from './components/CadViewport';

function downloadTextOrBytes(
  filename: string,
  content: string | Uint8Array,
  mime = 'text/plain;charset=utf-8'
) {
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: mime })
      : new Blob([new Uint8Array(content)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FEATURE_LABELS: Record<FeatureType, string> = {
  extrude_boss: 'Boss-Extrude',
  extrude_cut: 'Cut-Extrude',
  revolve: 'Revolve',
  revolve_cut: 'Cut-Revolve',
  swept_boss: 'Sweep',
  swept_cut: 'Cut-Sweep',
  loft_boss: 'Loft',
  hole_wizard: 'HoleWizard',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  draft: 'Draft',
  rib: 'Rib',
  linear_pattern: 'LPattern',
  circular_pattern: 'CirPattern',
  mirror: 'Mirror',
  combine: 'Combine',
};

export default function App() {
  const [project, setProject] = useState<CadProject>(() => createDefaultProject());
  const [hydrated, setHydrated] = useState(false);

  const [activeTab, setActiveTab] = useState<CommandTab>('features');
  const [partMeshes, setPartMeshes] = useState<Record<string, TessellatedMesh>>({});
  const [isBuildingGeometry, setIsBuildingGeometry] = useState(true);
  const [displayMode, setDisplayMode] = useState<'shaded_edges' | 'shaded' | 'wireframe'>('shaded_edges');

  const [selectedTreeItem, setSelectedTreeItem] = useState<SelectedTreeItem | null>(null);
  const [selectionFilter, setSelectionFilter] = useState<SelectionFilter>('face');
  const [sectionView, setSectionView] = useState<SectionViewState>({
    enabled: false,
    axis: 'z',
    offset: 0,
    flipped: false,
  });
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<number[]>([]);
  const [selectedVertexIds, setSelectedVertexIds] = useState<number[]>([]);
  const [cursorCoords, setCursorCoords] = useState<[number, number, number] | null>(null);

  // Sketching State
  const [activeSketch, setActiveSketch] = useState<SketchData | null>(null);
  const [sketchTool, setSketchTool] = useState<SketchTool>('line');
  const [selectedSketchEntityId, setSelectedSketchEntityId] = useState<string | null>(null);

  // Feature Draft State
  const [featureDraft, setFeatureDraft] = useState<ActiveFeatureDraft | null>(null);

  // Assembly State
  const [mateDraft, setMateDraft] = useState<ActiveMateDraft | null>(null);
  const [assemblyPanel, setAssemblyPanel] = useState<AssemblyToolPanel | null>(null);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [interferencePairs, setInterferencePairs] = useState<InterferencePair[] | null>(null);

  // Evaluate State
  const [evaluatePanel, setEvaluatePanel] = useState<EvaluateToolPanel>('measure');
  const [evaluateMode, setEvaluateMode] = useState<EvaluateVisualMode>('none');
  const [geometryCheckResult, setGeometryCheckResult] = useState<GeometryCheckResult | null>(null);

  // FEA State
  const [feaMesh, setFeaMesh] = useState<FeaMeshData | null>(null);
  const [feaResult, setFeaResult] = useState<FeaResult | null>(null);
  const [isSolvingFea, setIsSolvingFea] = useState(false);
  const [showFeaMeshOverlay, setShowFeaMeshOverlay] = useState(false);
  const [feaPickTarget, setFeaPickTarget] = useState<{
    kind: 'support' | 'load';
    id: string;
  } | null>(null);

  const [notice, setNotice] = useState<string | null>('OpenCascade.js çekirdeği başlatılıyor...');

  const activePart: PartDefinition = useMemo(
    () =>
      project.parts.find((p) => p.id === project.activePartId) ?? project.parts[0],
    [project.parts, project.activePartId]
  );

  const activePartMesh = partMeshes[activePart.id] ?? null;
  const activeMaterial = useMemo(
    () => getMaterialById(project.fea.materialId),
    [project.fea.materialId]
  );

  // Restore saved project from IndexedDB on mount
  useEffect(() => {
    let active = true;
    loadProjectFromIndexedDb().then((saved) => {
      if (!active) return;
      if (saved && saved.parts?.length > 0) {
        setProject(saved);
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Auto-save to IndexedDB
  useEffect(() => {
    if (!hydrated) return;
    const t = window.setTimeout(() => {
      saveProjectToIndexedDb({ ...project, updatedAt: Date.now() });
    }, 500);
    return () => clearTimeout(t);
  }, [project, hydrated]);

  // Build B-Rep geometry via OpenCascade.js Web Worker whenever parts change
  const buildGenRef = useRef(0);
  useEffect(() => {
    const gen = ++buildGenRef.current;
    setIsBuildingGeometry(true);

    Promise.all(
      project.parts.map(async (p) => {
        const mesh = await buildPartInWorker(p);
        return [p.id, mesh] as const;
      })
    )
      .then((entries) => {
        if (buildGenRef.current !== gen) return;
        const next: Record<string, TessellatedMesh> = {};
        for (const [id, m] of entries) next[id] = m;
        setPartMeshes(next);
        setIsBuildingGeometry(false);
        setNotice(null);

        const mainMesh = next[project.activePartId];
        if (mainMesh && mainMesh.faceInfos.length > 0) {
          setProject((prev) => {
            const supEmpty = prev.fea.supports.some((s) => s.faceIds.length === 0);
            const loadEmpty = prev.fea.loads.some((l) => l.faceIds.length === 0);
            if (!supEmpty && !loadEmpty) return prev;

            const backFixedFace =
              mainMesh.faceInfos.find((f) => f.normal[0] < -0.9 && f.center[0] < 2) ??
              mainMesh.faceInfos.find((f) => f.normal[1] < -0.9 && f.center[1] < 2) ??
              mainMesh.faceInfos[0];
            const flangeLoadFace =
              mainMesh.faceInfos.find(
                (f) => f.normal[1] > 0.9 && f.center[1] > 10 && f.center[1] < 20
              ) ??
              mainMesh.faceInfos.find((f) => f.normal[1] > 0.9) ??
              mainMesh.faceInfos[mainMesh.faceInfos.length - 1];

            return {
              ...prev,
              fea: {
                ...prev.fea,
                supports: prev.fea.supports.map((s, idx) =>
                  idx === 0 && s.faceIds.length === 0
                    ? { ...s, name: 'Fixed Support (Arka Duvar)', faceIds: [backFixedFace.faceId] }
                    : s
                ),
                loads: prev.fea.loads.map((l, idx) =>
                  idx === 0 && l.faceIds.length === 0
                    ? { ...l, name: 'Force (Flanş Yükü)', faceIds: [flangeLoadFace.faceId] }
                    : l
                ),
              },
            };
          });
        }
      })
      .catch((err) => {
        if (buildGenRef.current !== gen) return;
        setIsBuildingGeometry(false);
        setNotice(`Geometri hatası: ${err.message}`);
      });
  }, [project.parts, project.activePartId]);

  const solvedComponents = useMemo(() => {
    if (project.assemblyMates.length === 0) return project.assemblyComponents;
    return solveAssemblyMates(
      project.assemblyComponents,
      project.assemblyMates,
      partMeshes
    );
  }, [project.assemblyComponents, project.assemblyMates, partMeshes]);

  const displayedComponents = useMemo(
    () => computeExplodedComponents(solvedComponents, partMeshes, explodeFactor),
    [solvedComponents, partMeshes, explodeFactor]
  );

  const updateActivePart = useCallback(
    (updater: (part: PartDefinition) => PartDefinition) => {
      setProject((prev) => ({
        ...prev,
        parts: prev.parts.map((p) =>
          p.id === prev.activePartId ? updater(p) : p
        ),
      }));
      setFeaResult(null);
      setFeaMesh(null);
      setGeometryCheckResult(null);
    },
    []
  );

  // Sketch Handlers
  const handleStartNewSketch = () => {
    setActiveTab('sketch');
    const newSketch: SketchData = {
      id: `sketch_${Date.now()}`,
      name: `Sketch${activePart.sketches.length + 1}`,
      planeId: 'front',
      planeOffset: 0,
      entities: [],
      constraints: [],
    };
    setActiveSketch(newSketch);
    setSketchTool('rect');
    setSelectedSketchEntityId(null);
  };

  const handleEditSketch = (sk: SketchData) => {
    setActiveTab('sketch');
    setActiveSketch(JSON.parse(JSON.stringify(sk)));
    setSketchTool('select');
  };

  const handleExitSketch = (save: boolean) => {
    if (save && activeSketch) {
      updateActivePart((p) => {
        const exists = p.sketches.some((s) => s.id === activeSketch.id);
        return {
          ...p,
          sketches: exists
            ? p.sketches.map((s) => (s.id === activeSketch.id ? activeSketch : s))
            : [...p.sketches, activeSketch],
        };
      });
    }
    setActiveSketch(null);
    setSelectedSketchEntityId(null);
  };

  const handleAddSketchEntity = useCallback((entity: SketchEntity) => {
    setActiveSketch((prev) =>
      prev ? { ...prev, entities: [...prev.entities, entity] } : prev
    );
    setSelectedSketchEntityId(entity.id);
  }, []);

  const handleAddSketchEntityManual = (
    kind: 'rect' | 'circle' | 'line' | 'polygon' | 'slot'
  ) => {
    if (!activeSketch) return;
    const id = `ent_${Date.now()}`;
    if (kind === 'rect') {
      handleAddSketchEntity({ id, type: 'rect', x: 20, y: 20, width: 40, height: 25 });
    } else if (kind === 'circle') {
      handleAddSketchEntity({ id, type: 'circle', cx: 50, cy: 40, radius: 10 });
    } else if (kind === 'polygon') {
      handleAddSketchEntity({ id, type: 'polygon', cx: 50, cy: 40, radius: 14, sides: 6 });
    } else if (kind === 'slot') {
      handleAddSketchEntity({ id, type: 'slot', x1: 30, y1: 30, x2: 65, y2: 30, radius: 7 });
    } else {
      handleAddSketchEntity({ id, type: 'line', x1: 0, y1: 0, x2: 50, y2: 0 });
    }
  };

  const handleTrimSketchAt = useCallback((u: number, v: number) => {
    setActiveSketch((prev) =>
      prev
        ? { ...prev, entities: trimSketchEntityAtPoint(prev.entities, u, v, 6) }
        : prev
    );
  }, []);

  const handleSketchModify = (action: SketchModifyAction) => {
    if (!activeSketch) {
      setNotice('Bu işlem için önce bir 2D eskiz açın.');
      return;
    }

    if (action === 'convert_entities') {
      if (!activePartMesh || activePartMesh.edgeInfos.length === 0) return;
      const eInfo =
        activePartMesh.edgeInfos.find((ei) => selectedEdgeIds.includes(ei.edgeId)) ??
        activePartMesh.edgeInfos[0];
      const plane = resolvePlane(
        activeSketch.planeId,
        activeSketch.planeOffset ?? 0,
        activeSketch.customPlane
      );
      const conv = convertEdgeToSketchEntity(
        eInfo.midpoint,
        eInfo.tangent,
        eInfo.length,
        plane
      );
      handleAddSketchEntity(conv);
      setNotice(`Kenar #${eInfo.edgeId} eskiz düzlemine yansıtıldı (Convert Entities).`);
      return;
    }

    const target =
      activeSketch.entities.find((e) => e.id === selectedSketchEntityId) ??
      activeSketch.entities[activeSketch.entities.length - 1];
    if (!target) {
      setNotice('Çoğaltılacak veya ofsetlenecek bir eskiz öğesi bulunamadı.');
      return;
    }

    if (action === 'offset') {
      const copy = offsetSketchEntity(target, 5);
      if (copy) {
        handleAddSketchEntity(copy);
        setNotice('Geometri +5 mm ofsetlendi.');
      }
    } else if (action === 'mirror') {
      const centerline = activeSketch.entities.find(
        (e) => e.type === 'line' && e.construction
      );
      const axis =
        centerline && centerline.type === 'line'
          ? { x1: centerline.x1, y1: centerline.y1, x2: centerline.x2, y2: centerline.y2 }
          : 'y';
      const mirrored = mirrorSketchEntity(target, axis);
      handleAddSketchEntity(mirrored);
      setNotice('Geometri aynalandı (Mirror Entities).');
    } else if (action === 'linear_pattern') {
      const copies = linearPatternSketchEntity(target, 2, 32, 1, 20);
      setActiveSketch((prev) =>
        prev ? { ...prev, entities: [...prev.entities, ...copies] } : prev
      );
      setNotice('Doğrusal eskiz çoğaltma uygulandı.');
    } else if (action === 'circular_pattern') {
      const copies = circularPatternSketchEntity(target, 4, 360, 45, 35);
      setActiveSketch((prev) =>
        prev ? { ...prev, entities: [...prev.entities, ...copies] } : prev
      );
      setNotice('Dairesel eskiz çoğaltma (4x) uygulandı.');
    }
  };

  const handleApplySketchConstraint = (type: SketchRelationType) => {
    if (!activeSketch) {
      setNotice('İlişki/Kısıt eklemek için önce bir eskiz açın.');
      return;
    }
    const targetId =
      selectedSketchEntityId ??
      activeSketch.entities[activeSketch.entities.length - 1]?.id;
    if (!targetId) return;

    if (type === 'horizontal' || type === 'vertical') {
      setActiveSketch({
        ...activeSketch,
        constraints: [
          ...activeSketch.constraints,
          { id: `con_${Date.now()}`, type, entityId: targetId },
        ],
      });
      setNotice(`${type} ilişkisi eklendi.`);
      return;
    }

    if (activeSketch.entities.length < 2) {
      setNotice(`${type} ilişkisi için eskizde en az 2 geometri olmalıdır.`);
      return;
    }

    const a = activeSketch.entities[activeSketch.entities.length - 2];
    const b = activeSketch.entities[activeSketch.entities.length - 1];

    if (type === 'coincident') {
      setActiveSketch({
        ...activeSketch,
        constraints: [
          ...activeSketch.constraints,
          {
            id: `con_${Date.now()}`,
            type: 'coincident',
            entityAId: a.id,
            pointA: 'end',
            entityBId: b.id,
            pointB: 'start',
          },
        ],
      });
    } else {
      setActiveSketch({
        ...activeSketch,
        constraints: [
          ...activeSketch.constraints,
          {
            id: `con_${Date.now()}`,
            type,
            entityAId: a.id,
            entityBId: b.id,
          },
        ],
      });
    }
    setNotice(`${type} geometrik ilişkisi eklendi.`);
  };

  // Reference Geometry Handlers
  const handleAddReferenceGeometry = (kind: ReferenceGeometryItem['kind']) => {
    const existing = activePart.referenceGeometries ?? [];
    const idx = existing.length + 1;
    let item: ReferenceGeometryItem;
    if (kind === 'plane') {
      item = {
        id: `ref_${Date.now()}`,
        name: `Plane${idx}`,
        kind: 'plane',
        basePlane: 'top',
        offset: 40 + idx * 10,
      };
    } else if (kind === 'axis') {
      item = {
        id: `ref_${Date.now()}`,
        name: `Axis${idx}`,
        kind: 'axis',
        origin: [45, 0, 0],
        direction: [0, 1, 0],
      };
    } else if (kind === 'point') {
      item = {
        id: `ref_${Date.now()}`,
        name: `Point${idx}`,
        kind: 'point',
        position: [45, 35, 0],
      };
    } else {
      item = {
        id: `ref_${Date.now()}`,
        name: `CoordinateSystem${idx}`,
        kind: 'coord_sys',
        origin: [45, 16, 0],
        rotationEuler: [0, 0, 0],
      };
    }

    updateActivePart((p) => ({
      ...p,
      referenceGeometries: [...(p.referenceGeometries ?? []), item],
    }));
    setSelectedTreeItem({ kind: 'ref', refId: item.id });
    setNotice(`${item.name} referans geometrisi eklendi.`);
  };

  // Feature Handlers
  const handleStartFeature = (type: FeatureType) => {
    let latestPart = activePart;
    if (activeSketch) {
      const exists = activePart.sketches.some((s) => s.id === activeSketch.id);
      const nextSketches = exists
        ? activePart.sketches.map((s) => (s.id === activeSketch.id ? activeSketch : s))
        : [...activePart.sketches, activeSketch];
      latestPart = { ...activePart, sketches: nextSketches };
      updateActivePart(() => latestPart);
      setActiveSketch(null);
    }

    setActiveTab('features');
    const lastSketchId =
      latestPart.sketches[latestPart.sketches.length - 1]?.id ?? '';
    const count = latestPart.features.length + 1;

    setFeatureDraft({
      mode: 'create',
      feature: {
        id: `feat_${Date.now()}`,
        name: `${FEATURE_LABELS[type]}${count}`,
        type,
        sketchId: lastSketchId,
        profileSketchIds: latestPart.sketches.slice(-2).map((s) => s.id),
        depth: 20,
        symmetric: false,
        direction: type === 'extrude_cut' ? -1 : 1,
        draftExtrudeDeg: 0,
        angleDeg: 360,
        revolveAxis: 'y',
        radius: 4,
        distance: 2,
        edgePreset: type === 'fillet' ? 'inner_fillet' : 'top_edges',
        holeStandard: 'counterbore',
        holeDiameter: 9,
        holeDepth: 25,
        cboreDiameter: 14.5,
        cboreDepth: 6,
        csinkDiameter: 16,
        holeX: 45,
        holeY: 18,
        holeZ: 0,
        holeAxis: 'y',
        thickness: 2.5,
        shellOutward: false,
        openFaceIds: selectedFaceIds.length > 0 ? [...selectedFaceIds] : undefined,
        draftAngleDeg: 5,
        draftAxis: 'y',
        ribThickness: 8,
        patternCountX: 2,
        patternSpacingX: 45,
        patternCountY: 1,
        patternSpacingY: 30,
        circularCount: 4,
        circularAngleDeg: 360,
        patternAxis: 'y',
        mirrorPlane: 'right',
        combineOp: 'add',
        combinePrimShape: 'cylinder',
        combineSize: [22, 30, 22],
        combineOffset: [45, 16, 0],
      },
    });
  };

  const handleCommitFeatureDraft = (draft: ActiveFeatureDraft) => {
    updateActivePart((p) => ({
      ...p,
      features: [...p.features, draft.feature],
    }));
    setFeatureDraft(null);
  };

  const handleUpdateExistingFeature = (feat: CadFeature) => {
    updateActivePart((p) => ({
      ...p,
      features: p.features.map((f) => (f.id === feat.id ? feat : f)),
    }));
  };

  // Face / Edge Picking
  const handlePickFace = useCallback(
    (componentId: string, faceId: number) => {
      if (activeTab === 'fea' && feaPickTarget) {
        setProject((prev) => {
          if (feaPickTarget.kind === 'support') {
            return {
              ...prev,
              fea: {
                ...prev.fea,
                supports: prev.fea.supports.map((s) =>
                  s.id === feaPickTarget.id
                    ? {
                        ...s,
                        faceIds: s.faceIds.includes(faceId)
                          ? s.faceIds
                          : [...s.faceIds, faceId],
                      }
                    : s
                ),
              },
            };
          }
          return {
            ...prev,
            fea: {
              ...prev.fea,
              loads: prev.fea.loads.map((l) =>
                l.id === feaPickTarget.id
                  ? {
                      ...l,
                      faceIds: l.faceIds.includes(faceId)
                        ? l.faceIds
                        : [...l.faceIds, faceId],
                    }
                  : l
              ),
            },
          };
        });
        setSelectedFaceIds([faceId]);
        return;
      }

      if (activeTab === 'assembly' && mateDraft && mateDraft.pickingTarget) {
        if (mateDraft.pickingTarget === 'A') {
          setMateDraft({
            ...mateDraft,
            componentAId: componentId === 'active_part_inst' ? mateDraft.componentAId : componentId,
            faceAId: faceId,
            pickingTarget: 'B',
          });
        } else {
          setMateDraft({
            ...mateDraft,
            componentBId: componentId === 'active_part_inst' ? mateDraft.componentBId : componentId,
            faceBId: faceId,
            pickingTarget: null,
          });
        }
        setSelectedFaceIds([faceId]);
        return;
      }

      setSelectedFaceIds((prev) =>
        activeTab === 'evaluate' ? toggleSelectionId(prev, faceId) : [faceId]
      );
    },
    [activeTab, feaPickTarget, mateDraft]
  );

  const handlePickEdge = useCallback((edgeId: number) => {
    setSelectedEdgeIds((prev) => toggleSelectionId(prev, edgeId));
  }, []);

  const handlePickVertex = useCallback((_componentId: string, vertexId: number) => {
    setSelectedVertexIds((prev) => toggleSelectionId(prev, vertexId));
  }, []);

  // Assembly Handlers
  const handleAddAssemblyPart = (partId: string) => {
    const partDef = project.parts.find((p) => p.id === partId);
    if (!partDef) return;
    const count = project.assemblyComponents.length + 1;
    const comp: AssemblyComponent = {
      id: `comp_${Date.now()}`,
      partId,
      name: `${partDef.name}-${count}`,
      position: [45 * (count - 1), 20, 35],
      rotationEuler: [0, 0, 0],
      fixed: false,
      color: partDef.color,
    };
    setProject((prev) => ({
      ...prev,
      assemblyComponents: [...prev.assemblyComponents, comp],
    }));
    setNotice(`${comp.name} montaja eklendi.`);
  };

  const handleStartAssemblyMate = (type: MateType) => {
    setAssemblyPanel(null);
    const mainMesh = partMeshes[project.activePartId];
    const cylFaceA =
      type === 'concentric' && mainMesh
        ? mainMesh.faceInfos.find((f) => f.isCylindrical && (f.cylinderRadius ?? 0) > 9)?.faceId ??
          mainMesh.faceInfos.find((f) => f.isCylindrical)?.faceId ??
          0
        : 0;

    if (project.assemblyComponents.length < 2) {
      const pin = project.parts.find((p) => p.id !== project.activePartId) ?? project.parts[0];
      const newComp: AssemblyComponent = {
        id: `comp_${Date.now()}`,
        partId: pin.id,
        name: `${pin.name}-2`,
        position: [65, 45, 35],
        rotationEuler: [0, 0, 0],
        fixed: false,
        color: pin.color,
      };
      setProject((prev) => ({
        ...prev,
        assemblyComponents: [...prev.assemblyComponents, newComp],
      }));
      setMateDraft({
        type,
        componentAId: project.assemblyComponents[0].id,
        faceAId: cylFaceA,
        componentBId: newComp.id,
        faceBId: 0,
        distanceValue: 10,
        angleValue: 45,
        pickingTarget: 'A',
      });
      return;
    }

    setMateDraft({
      type,
      componentAId: project.assemblyComponents[0].id,
      faceAId: cylFaceA,
      componentBId: project.assemblyComponents[1].id,
      faceBId: 0,
      distanceValue: 10,
      angleValue: 45,
      pickingTarget: 'A',
    });
  };

  const handleCommitMateDraft = (draft: ActiveMateDraft) => {
    const newMate: AssemblyMate = {
      id: `mate_${Date.now()}`,
      name: `Mate${project.assemblyMates.length + 1}`,
      type: draft.type,
      componentAId: draft.componentAId,
      faceAId: draft.faceAId,
      componentBId: draft.componentBId,
      faceBId: draft.faceBId,
      distanceValue: draft.distanceValue,
      angleValue: draft.angleValue,
    };
    setProject((prev) => ({
      ...prev,
      assemblyMates: [...prev.assemblyMates, newMate],
    }));
    setMateDraft(null);
    setNotice(`${newMate.name} (${newMate.type}) uygulandı.`);
  };

  const handleAssemblyPattern = () => {
    const target =
      solvedComponents.find((c) => !c.fixed) ??
      solvedComponents[solvedComponents.length - 1];
    if (!target) return;
    const copy: AssemblyComponent = {
      ...target,
      id: `comp_pat_${Date.now()}`,
      name: `${target.name}_Pat`,
      position: [target.position[0] + 45, target.position[1], target.position[2]],
      fixed: false,
    };
    setProject((prev) => ({
      ...prev,
      assemblyComponents: [...prev.assemblyComponents, copy],
    }));
    setNotice(`${copy.name} bileşen çoğaltma ile eklendi.`);
  };

  const handleAssemblyMirror = () => {
    const target =
      solvedComponents.find((c) => !c.fixed) ??
      solvedComponents[solvedComponents.length - 1];
    if (!target) return;
    const copy: AssemblyComponent = {
      ...target,
      id: `comp_mir_${Date.now()}`,
      name: `${target.name}_Mirror`,
      position: [90 - target.position[0], target.position[1], -target.position[2]],
      rotationEuler: [target.rotationEuler[0], -target.rotationEuler[1], target.rotationEuler[2]],
      fixed: false,
    };
    setProject((prev) => ({
      ...prev,
      assemblyComponents: [...prev.assemblyComponents, copy],
    }));
    setNotice(`${copy.name} aynalanarak eklendi.`);
  };

  const handleRunInterferenceCheck = () => {
    const pairs = detectAssemblyInterference(solvedComponents, partMeshes);
    setInterferencePairs(pairs);
    setAssemblyPanel('interference');
    setMateDraft(null);
    setNotice(
      pairs.length === 0
        ? 'Çakışma analizi tamamlandı: 0 girişim.'
        : `${pairs.length} bileşen çiftinde çakışma tespit edildi.`
    );
  };

  // Evaluate Handlers
  const handleRunCheckGeometry = async () => {
    setEvaluatePanel('check_geometry');
    setNotice('OpenCascade BRepCheck_Analyzer çalışıyor...');
    try {
      const res = await checkGeometryInWorker(activePart);
      setGeometryCheckResult(res);
      setNotice(res.isValid ? 'B-Rep Geometri Kontrolü: Geçerli Katı Model.' : res.summary);
    } catch (err: any) {
      setNotice(`Geometri kontrol hatası: ${err.message}`);
    }
  };

  // FEA Handlers
  const meshCacheKey = useMemo(
    () => `${activePart.id}_${activePart.features.length}_${activePartMesh?.indices.length ?? 0}`,
    [activePart.id, activePart.features.length, activePartMesh?.indices.length]
  );

  const handleGenerateFeaMesh = async () => {
    if (!activePartMesh) return;
    setNotice('Tetrahedral FEA ağı oluşturuluyor...');
    try {
      const m = await generateFeaMeshInWorker(
        activePartMesh,
        project.fea.meshResolution,
        meshCacheKey
      );
      setFeaMesh(m);
      setShowFeaMeshOverlay(true);
      setNotice(`Mesh hazır: ${m.nodeCount} düğüm, ${m.elementCount} tetrahedral eleman.`);
    } catch (err: any) {
      setNotice(`Mesh hatası: ${err.message}`);
    }
  };

  const handleRunFeaSolve = async () => {
    if (!activePartMesh) return;
    setIsSolvingFea(true);
    setNotice('Doğrusal statik FEA çözücüsü çalışıyor...');
    try {
      const { feaMesh: solvedMesh, feaResult: solvedResult } = await solveFeaInWorker(
        activePartMesh,
        activeMaterial,
        project.fea,
        meshCacheKey
      );
      setFeaMesh(solvedMesh);
      setFeaResult(solvedResult);
      setShowFeaMeshOverlay(false);
      setNotice(
        `Analiz tamamlandı (${solvedResult.solveTimeMs} ms) · Maks Von Mises: ${solvedResult.maxVonMises.toFixed(2)} MPa`
      );
    } catch (err: any) {
      setNotice(`FEA çözüm hatası: ${err.message}`);
    } finally {
      setIsSolvingFea(false);
    }
  };

  // File Export / Import
  const handleExportFile = async (fmt: 'step' | 'iges' | 'stl' | 'obj' | 'mcad') => {
    try {
      if (fmt === 'mcad') {
        downloadTextOrBytes(
          `${project.name}.mcad.json`,
          serializeProjectToMcadJson(project),
          'application/json'
        );
        setNotice(`${project.name}.mcad.json indirildi.`);
        return;
      }

      if (!activePartMesh) {
        setNotice('Dışa aktarılacak aktif geometri bulunamadı.');
        return;
      }

      if (fmt === 'step') {
        setNotice('STEP (AP214) oluşturuluyor...');
        const stepStr = await exportStepInWorker(activePart);
        downloadTextOrBytes(`${activePart.name}.step`, stepStr, 'application/step');
        setNotice(`${activePart.name}.step (AP214) indirildi.`);
      } else if (fmt === 'iges') {
        const igesStr = exportMeshToIGES(activePartMesh, activePart.name);
        downloadTextOrBytes(`${activePart.name}.igs`, igesStr, 'application/iges');
        setNotice(`${activePart.name}.igs (IGES 5.3) indirildi.`);
      } else if (fmt === 'stl') {
        const stlStr = exportMeshToSTL(activePartMesh, activePart.name);
        downloadTextOrBytes(`${activePart.name}.stl`, stlStr, 'model/stl');
        setNotice(`${activePart.name}.stl indirildi.`);
      } else if (fmt === 'obj') {
        const objStr = exportMeshToOBJ(activePartMesh, activePart.name);
        downloadTextOrBytes(`${activePart.name}.obj`, objStr, 'text/plain');
        setNotice(`${activePart.name}.obj indirildi.`);
      }
    } catch (err: any) {
      setNotice(`Dışa aktarım hatası: ${err.message}`);
    }
  };

  const handleImportFile = async (file: File) => {
    const ext = file.name.toLowerCase();
    try {
      if (ext.endsWith('.json')) {
        const text = await file.text();
        const loaded = parseMcadJson(text);
        setProject(loaded);
        setFeaMesh(null);
        setFeaResult(null);
        setNotice(`Proje yüklendi: ${loaded.name}`);
      } else if (ext.endsWith('.step') || ext.endsWith('.stp')) {
        setNotice('STEP dosyası OpenCascade ile içe aktarılıyor...');
        const stepText = await file.text();
        await importStepInWorker(stepText);
        const newPart: PartDefinition = {
          id: `part_step_${Date.now()}`,
          name: file.name.replace(/\.(step|stp)$/i, ''),
          color: '#9aa5b4',
          sketches: [],
          features: [],
          importedStepData: stepText,
        };
        setProject((prev) => ({
          ...prev,
          activePartId: newPart.id,
          parts: [...prev.parts, newPart],
          assemblyComponents: [
            ...prev.assemblyComponents,
            {
              id: `comp_${Date.now()}`,
              partId: newPart.id,
              name: newPart.name,
              position: [0, 0, 0],
              rotationEuler: [0, 0, 0],
              fixed: true,
              color: newPart.color,
            },
          ],
        }));
        setNotice(`STEP modeli içe aktarıldı: ${newPart.name}`);
      } else if (ext.endsWith('.igs') || ext.endsWith('.iges')) {
        const text = await file.text();
        const soup = parseIGES(text);
        const newPart: PartDefinition = {
          id: `part_iges_${Date.now()}`,
          name: file.name.replace(/\.(igs|iges)$/i, ''),
          color: '#9aa5b4',
          sketches: [],
          features: [],
          importedMesh: soup,
        };
        setProject((prev) => ({
          ...prev,
          activePartId: newPart.id,
          parts: [...prev.parts, newPart],
        }));
        setNotice(`IGES dosyası içe aktarıldı: ${newPart.name}`);
      } else if (ext.endsWith('.stl')) {
        const buf = await file.arrayBuffer();
        const soup = parseSTL(buf);
        const newPart: PartDefinition = {
          id: `part_stl_${Date.now()}`,
          name: file.name.replace(/\.stl$/i, ''),
          color: '#9aa5b4',
          sketches: [],
          features: [],
          importedMesh: soup,
        };
        setProject((prev) => ({
          ...prev,
          activePartId: newPart.id,
          parts: [...prev.parts, newPart],
        }));
        setNotice(`STL dosyası içe aktarıldı: ${newPart.name}`);
      } else if (ext.endsWith('.obj')) {
        const text = await file.text();
        const soup = parseOBJ(text);
        const newPart: PartDefinition = {
          id: `part_obj_${Date.now()}`,
          name: file.name.replace(/\.obj$/i, ''),
          color: '#9aa5b4',
          sketches: [],
          features: [],
          importedMesh: soup,
        };
        setProject((prev) => ({
          ...prev,
          activePartId: newPart.id,
          parts: [...prev.parts, newPart],
        }));
        setNotice(`OBJ dosyası içe aktarıldı: ${newPart.name}`);
      }
    } catch (err: any) {
      setNotice(`İçe aktarım hatası: ${err.message}`);
    }
  };

  const handleResetDefault = () => {
    const def = createDefaultProject();
    setProject(def);
    setActiveSketch(null);
    setFeatureDraft(null);
    setMateDraft(null);
    setAssemblyPanel(null);
    setExplodeFactor(0);
    setInterferencePairs(null);
    setEvaluateMode('none');
    setGeometryCheckResult(null);
    setFeaMesh(null);
    setFeaResult(null);
    setSelectedFaceIds([]);
    setSelectedEdgeIds([]);
    setSelectedVertexIds([]);
    setSelectionFilter('face');
    setSectionView({ enabled: false, axis: 'z', offset: 0, flipped: false });
    setNotice('Varsayılan Delikli Braket modeli geri yüklendi.');
  };

  return (
    <div
      className="w-screen h-screen flex flex-col bg-[#12161D] text-[#E6EDF3] overflow-hidden"
      data-state={isBuildingGeometry ? 'building' : 'ready'}
    >
      <CommandManager
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'sketch' && activeSketch) handleExitSketch(true);
          if (tab !== 'fea') setFeaPickTarget(null);
          if (tab !== 'evaluate') setEvaluateMode('none');
          if (tab !== 'assembly') setAssemblyPanel(null);
          if (tab === 'assembly' || tab === 'evaluate' || tab === 'fea') {
            setSelectedTreeItem(null);
          }
        }}
        isSketchActive={Boolean(activeSketch)}
        sketchTool={sketchTool}
        onSetSketchTool={setSketchTool}
        onStartNewSketch={handleStartNewSketch}
        onExitSketch={handleExitSketch}
        onApplySketchConstraint={handleApplySketchConstraint}
        onSketchModify={handleSketchModify}
        onStartFeature={handleStartFeature}
        onAddReferenceGeometry={handleAddReferenceGeometry}
        onAddAssemblyPart={handleAddAssemblyPart}
        onStartAssemblyMate={handleStartAssemblyMate}
        onOpenAssemblyTool={(panel) => {
          setMateDraft(null);
          if (panel !== 'move') setSelectedTreeItem(null);
          if (panel === 'interference') {
            handleRunInterferenceCheck();
          } else {
            setAssemblyPanel(panel);
          }
        }}
        onAssemblyPattern={handleAssemblyPattern}
        onAssemblyMirror={handleAssemblyMirror}
        explodeFactor={explodeFactor}
        onOpenEvaluateTool={(panel) => {
          setActiveTab('evaluate');
          setFeatureDraft(null);
          setMateDraft(null);
          setSelectedTreeItem(null);
          if (panel === 'check_geometry') {
            handleRunCheckGeometry();
          } else {
            setEvaluatePanel(panel);
          }
        }}
        evaluateMode={evaluateMode}
        onToggleEvaluateMode={(mode) =>
          setEvaluateMode((prev) => (prev === mode ? 'none' : mode))
        }
        feaSettings={project.fea}
        onUpdateFeaMode={(mode) =>
          setProject((prev) => ({ ...prev, fea: { ...prev.fea, resultMode: mode } }))
        }
        onGenerateFeaMesh={handleGenerateFeaMesh}
        onStartAddSupport={() => {
          const newSupId = `sup_${Date.now()}`;
          setProject((prev) => ({
            ...prev,
            fea: {
              ...prev.fea,
              supports: [
                ...prev.fea.supports,
                {
                  id: newSupId,
                  name: `Fixed Support ${prev.fea.supports.length + 1}`,
                  faceIds: selectedFaceIds.length > 0 ? [...selectedFaceIds] : [],
                  type: 'fixed',
                },
              ],
            },
          }));
          setFeaPickTarget({ kind: 'support', id: newSupId });
          setSelectionFilter('face');
          setNotice('Sabit mesnet için 3D modelden yüzey seçin.');
        }}
        onStartAddLoad={() => {
          const newLoadId = `load_${Date.now()}`;
          setProject((prev) => ({
            ...prev,
            fea: {
              ...prev.fea,
              loads: [
                ...prev.fea.loads,
                {
                  id: newLoadId,
                  name: `Force ${prev.fea.loads.length + 1}`,
                  faceIds: selectedFaceIds.length > 0 ? [...selectedFaceIds] : [],
                  type: 'force',
                  magnitude: 1500,
                  direction: [0, -1, 0],
                  useFaceNormal: false,
                },
              ],
            },
          }));
          setFeaPickTarget({ kind: 'load', id: newLoadId });
          setSelectionFilter('face');
          setNotice('Kuvvet/Basınç için 3D modelden yüzey seçin.');
        }}
        onRunFeaSolve={handleRunFeaSolve}
        isSolvingFea={isSolvingFea}
        onExportFile={handleExportFile}
        onImportFile={handleImportFile}
        onResetProject={handleResetDefault}
        onSaveNow={() => {
          saveProjectToIndexedDb({ ...project, updatedAt: Date.now() });
          setNotice('Proje tarayıcıya (IndexedDB) kaydedildi.');
        }}
        sectionViewEnabled={sectionView.enabled}
        onToggleSectionView={() =>
          setSectionView((prev) => {
            const nextEnabled = !prev.enabled;
            if (nextEnabled && activePartMesh) {
              const axisIdx = prev.axis === 'x' ? 0 : prev.axis === 'y' ? 1 : 2;
              const mid =
                Math.round(
                  ((activePartMesh.boundingBox.min[axisIdx] +
                    activePartMesh.boundingBox.max[axisIdx]) *
                    0.5) *
                    10
                ) / 10;
              return { ...prev, enabled: true, offset: mid };
            }
            return { ...prev, enabled: nextEnabled };
          })
        }
        availableParts={project.parts.map((p) => ({ id: p.id, name: p.name }))}
      />

      {/* Main Split Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <aside className="w-[310px] shrink-0 bg-[#161B23] border-r border-[#2A3241] flex flex-col min-h-0">
          <div className="max-h-[45%] overflow-y-auto border-b border-[#262E3D]">
            <FeatureTree
              activeTab={activeTab}
              part={activePart}
              components={displayedComponents}
              mates={project.assemblyMates}
              feaSettings={project.fea}
              feaMesh={feaMesh}
              feaResult={feaResult}
              selectedItem={selectedTreeItem}
              onSelectItem={(item) => {
                setSelectedTreeItem(item);
                if (item.kind === 'fea_mesh') setShowFeaMeshOverlay(true);
                if (item.kind === 'fea_solution') setShowFeaMeshOverlay(false);
              }}
              onEditSketch={handleEditSketch}
              onToggleFeatureSuppress={(fId) =>
                updateActivePart((p) => ({
                  ...p,
                  features: p.features.map((f) =>
                    f.id === fId ? { ...f, suppressed: !f.suppressed } : f
                  ),
                }))
              }
              onDeleteFeature={(fId) =>
                updateActivePart((p) => ({
                  ...p,
                  features: p.features.filter((f) => f.id !== fId),
                }))
              }
              onDeleteSketch={(sId) =>
                updateActivePart((p) => ({
                  ...p,
                  sketches: p.sketches.filter((s) => s.id !== sId),
                  features: p.features.filter((f) => f.sketchId !== sId),
                }))
              }
              onDeleteReferenceGeometry={(rId) =>
                updateActivePart((p) => ({
                  ...p,
                  referenceGeometries: (p.referenceGeometries ?? []).filter((r) => r.id !== rId),
                }))
              }
              onDeleteComponent={(cId) =>
                setProject((prev) => ({
                  ...prev,
                  assemblyComponents: prev.assemblyComponents.filter((c) => c.id !== cId),
                  assemblyMates: prev.assemblyMates.filter(
                    (m) => m.componentAId !== cId && m.componentBId !== cId
                  ),
                }))
              }
              onDeleteMate={(mId) =>
                setProject((prev) => ({
                  ...prev,
                  assemblyMates: prev.assemblyMates.filter((m) => m.id !== mId),
                }))
              }
              onSelectFeaResultMode={(mode) =>
                setProject((prev) => ({
                  ...prev,
                  fea: { ...prev.fea, resultMode: mode },
                }))
              }
            />
          </div>

          <div className="flex-1 overflow-y-auto bg-[#141921]">
            <PropertyPanel
              activeTab={activeTab}
              part={activePart}
              partMesh={activePartMesh}
              partMeshes={partMeshes}
              parts={project.parts}
              selectedItem={selectedTreeItem}
              selectionFilter={selectionFilter}
              selectedFaceIds={selectedFaceIds}
              selectedEdgeIds={selectedEdgeIds}
              selectedVertexIds={selectedVertexIds}
              activeSketch={activeSketch}
              selectedSketchEntityId={selectedSketchEntityId}
              onUpdateSketchPlane={(planeId: PlaneId, offset: number) =>
                setActiveSketch((prev) =>
                  prev ? { ...prev, planeId, planeOffset: offset } : prev
                )
              }
              onAddSketchEntityManual={handleAddSketchEntityManual}
              onUpdateSketchEntityDim={(entityId, patch) =>
                setActiveSketch((prev) =>
                  prev
                    ? {
                        ...prev,
                        entities: prev.entities.map((e) =>
                          e.id === entityId ? ({ ...e, ...patch } as SketchEntity) : e
                        ),
                      }
                    : prev
                )
              }
              onDeleteSketchConstraint={(constraintId) =>
                setActiveSketch((prev) =>
                  prev
                    ? {
                        ...prev,
                        constraints: prev.constraints.filter((c) => c.id !== constraintId),
                      }
                    : prev
                )
              }
              onUpdateReferenceGeometry={(refItem) =>
                updateActivePart((p) => ({
                  ...p,
                  referenceGeometries: (p.referenceGeometries ?? []).map((r) =>
                    r.id === refItem.id ? refItem : r
                  ),
                }))
              }
              featureDraft={featureDraft}
              onChangeFeatureDraft={setFeatureDraft}
              onCommitFeatureDraft={handleCommitFeatureDraft}
              onUpdateExistingFeature={handleUpdateExistingFeature}
              components={displayedComponents}
              onUpdateComponentTransform={(compId, position, rotationEuler) =>
                setProject((prev) => ({
                  ...prev,
                  assemblyComponents: prev.assemblyComponents.map((c) =>
                    c.id === compId ? { ...c, position, rotationEuler } : c
                  ),
                }))
              }
              mateDraft={mateDraft}
              onChangeMateDraft={setMateDraft}
              onCommitMateDraft={handleCommitMateDraft}
              assemblyPanel={assemblyPanel}
              explodeFactor={explodeFactor}
              onChangeExplodeFactor={setExplodeFactor}
              interferencePairs={interferencePairs}
              onRunInterferenceCheck={handleRunInterferenceCheck}
              evaluatePanel={evaluatePanel}
              evaluateMode={evaluateMode}
              geometryCheckResult={geometryCheckResult}
              onRunCheckGeometry={handleRunCheckGeometry}
              feaSettings={project.fea}
              feaMesh={feaMesh}
              feaResult={feaResult}
              feaPickTarget={feaPickTarget}
              onSetFeaPickTarget={setFeaPickTarget}
              onUpdateFeaSettings={(patch: Partial<FeaSettings>) =>
                setProject((prev) => ({
                  ...prev,
                  fea: { ...prev.fea, ...patch },
                }))
              }
              onGenerateFeaMesh={handleGenerateFeaMesh}
              onRunFeaSolve={handleRunFeaSolve}
              onDeleteSupport={(id) =>
                setProject((prev) => ({
                  ...prev,
                  fea: {
                    ...prev.fea,
                    supports: prev.fea.supports.filter((s) => s.id !== id),
                  },
                }))
              }
              onDeleteLoad={(id) =>
                setProject((prev) => ({
                  ...prev,
                  fea: {
                    ...prev.fea,
                    loads: prev.fea.loads.filter((l) => l.id !== id),
                  },
                }))
              }
            />
          </div>
        </aside>

        {/* Center 3D CAD / FEA Viewport */}
        <main className="flex-1 relative flex flex-col min-w-0">
          {notice && (
            <div className="absolute top-3 left-3 z-10 bg-[#161B23]/95 border border-[#2D3849] rounded px-3 py-1.5 text-xs text-[#E6EDF3] shadow-md flex items-center gap-3">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-[#8B98AA] hover:text-white text-[11px]"
              >
                Kapat
              </button>
            </div>
          )}

          <CadViewport
            activeTab={activeTab}
            activePartId={activePart.id}
            partMeshes={partMeshes}
            components={displayedComponents}
            unexplodedComponents={solvedComponents}
            explodeFactor={explodeFactor}
            referenceGeometries={activePart.referenceGeometries}
            evaluateMode={evaluateMode}
            material={activeMaterial}
            displayMode={displayMode}
            onChangeDisplayMode={setDisplayMode}
            selectionFilter={selectionFilter}
            onChangeSelectionFilter={setSelectionFilter}
            sectionView={sectionView}
            onChangeSectionView={setSectionView}
            selectedFaceIds={selectedFaceIds}
            selectedEdgeIds={selectedEdgeIds}
            selectedVertexIds={selectedVertexIds}
            onPickFace={handlePickFace}
            onPickEdge={handlePickEdge}
            onPickVertex={handlePickVertex}
            activeSketch={activeSketch}
            sketchTool={sketchTool}
            onAddSketchEntity={handleAddSketchEntity}
            onTrimSketchAt={handleTrimSketchAt}
            onSelectSketchEntity={setSelectedSketchEntityId}
            onCursorMove3D={setCursorCoords}
            feaSettings={project.fea}
            feaMesh={feaMesh}
            feaResult={feaResult}
            showFeaMeshOverlay={showFeaMeshOverlay}
          />
        </main>
      </div>

      {/* Engineering Unit & Coordinate Footer */}
      <footer className="h-6 px-3 bg-[#151A22] border-t border-[#262F3E] flex items-center justify-between text-[11px] text-[#8B98AA] font-mono-tabular shrink-0">
        <div className="flex items-center gap-3">
          <span>Birimler: mm · kg · N · MPa</span>
          <span aria-hidden="true">·</span>
          <span>
            {activePartMesh
              ? `${activePartMesh.indices.length / 3} Üçgen · ${activePartMesh.faceInfos.length} Yüzey`
              : 'Model hazırlanıyor...'}
          </span>
        </div>
        <div>
          {cursorCoords
            ? `X: ${cursorCoords[0].toFixed(1)}  Y: ${cursorCoords[1].toFixed(1)}  Z: ${cursorCoords[2].toFixed(1)} mm`
            : 'Hazır'}
        </div>
      </footer>
    </div>
  );
}
