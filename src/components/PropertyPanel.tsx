import React, { useMemo, useState } from 'react';
import {
  AssemblyComponent,
  CadFeature,
  CommandTab,
  EvaluateVisualMode,
  FeaMeshData,
  FeaResult,
  FeaSettings,
  GeometryCheckResult,
  InterferencePair,
  MateType,
  PartDefinition,
  PlaneId,
  ReferenceGeometryItem,
  SelectionFilter,
  SketchData,
  TessellatedMesh,
} from '../types/cad';
import { getMaterialById, MATERIAL_LIBRARY } from '../data/materials';
import { distanceBetweenPoints } from '../utils/selectionUtils';
import {
  computeMomentsOfInertia,
  measureFacesAngleDeg,
} from '../utils/evaluateUtils';
import { AssemblyToolPanel, EvaluateToolPanel } from './CommandManager';
import { SelectedTreeItem } from './FeatureTree';

export interface ActiveFeatureDraft {
  mode: 'create' | 'edit';
  feature: CadFeature;
}

export interface ActiveMateDraft {
  type: MateType;
  componentAId: string;
  faceAId: number;
  componentBId: string;
  faceBId: number;
  distanceValue: number;
  angleValue: number;
  pickingTarget: 'A' | 'B' | null;
}

interface PropertyPanelProps {
  activeTab: CommandTab;
  part: PartDefinition;
  partMesh: TessellatedMesh | null;
  partMeshes: Record<string, TessellatedMesh>;
  parts: PartDefinition[];
  selectedItem: SelectedTreeItem | null;
  selectionFilter: SelectionFilter;
  selectedFaceIds: number[];
  selectedEdgeIds: number[];
  selectedVertexIds: number[];
  activeSketch: SketchData | null;
  selectedSketchEntityId: string | null;
  onUpdateSketchPlane: (planeId: PlaneId, offset: number) => void;
  onAddSketchEntityManual: (kind: 'rect' | 'circle' | 'line' | 'polygon' | 'slot') => void;
  onUpdateSketchEntityDim: (entityId: string, patch: Record<string, number>) => void;
  onDeleteSketchConstraint: (constraintId: string) => void;
  onUpdateReferenceGeometry: (ref: ReferenceGeometryItem) => void;
  featureDraft: ActiveFeatureDraft | null;
  onChangeFeatureDraft: (draft: ActiveFeatureDraft | null) => void;
  onCommitFeatureDraft: (draft: ActiveFeatureDraft) => void;
  onUpdateExistingFeature: (feat: CadFeature) => void;
  components: AssemblyComponent[];
  onUpdateComponentTransform: (
    compId: string,
    position: [number, number, number],
    rotationEuler: [number, number, number]
  ) => void;
  mateDraft: ActiveMateDraft | null;
  onChangeMateDraft: (draft: ActiveMateDraft | null) => void;
  onCommitMateDraft: (draft: ActiveMateDraft) => void;
  assemblyPanel: AssemblyToolPanel | null;
  explodeFactor: number;
  onChangeExplodeFactor: (v: number) => void;
  interferencePairs: InterferencePair[] | null;
  onRunInterferenceCheck: () => void;
  evaluatePanel: EvaluateToolPanel;
  evaluateMode: EvaluateVisualMode;
  geometryCheckResult: GeometryCheckResult | null;
  onRunCheckGeometry: () => void;
  feaSettings: FeaSettings;
  feaMesh: FeaMeshData | null;
  feaResult: FeaResult | null;
  feaPickTarget: { kind: 'support' | 'load'; id: string } | null;
  onSetFeaPickTarget: (t: { kind: 'support' | 'load'; id: string } | null) => void;
  onUpdateFeaSettings: (patch: Partial<FeaSettings>) => void;
  onGenerateFeaMesh: () => void;
  onRunFeaSolve: () => void;
  onDeleteSupport: (id: string) => void;
  onDeleteLoad: (id: string) => void;
}

const HOLE_ISO_PRESETS = [
  { label: 'M6', d: 6.6, cbD: 11, cbH: 6, csD: 12 },
  { label: 'M8', d: 9, cbD: 14.5, cbH: 8, csD: 16 },
  { label: 'M10', d: 11, cbD: 17.5, cbH: 10, csD: 20 },
  { label: 'M12', d: 13.5, cbD: 20, cbH: 12, csD: 24 },
];

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  activeTab,
  part,
  partMesh,
  partMeshes,
  parts,
  selectedItem,
  selectionFilter,
  selectedFaceIds,
  selectedEdgeIds,
  selectedVertexIds,
  activeSketch,
  selectedSketchEntityId,
  onUpdateSketchPlane,
  onAddSketchEntityManual,
  onUpdateSketchEntityDim,
  onDeleteSketchConstraint,
  onUpdateReferenceGeometry,
  featureDraft,
  onChangeFeatureDraft,
  onCommitFeatureDraft,
  onUpdateExistingFeature,
  components,
  onUpdateComponentTransform,
  mateDraft,
  onChangeMateDraft,
  onCommitMateDraft,
  assemblyPanel,
  explodeFactor,
  onChangeExplodeFactor,
  interferencePairs,
  onRunInterferenceCheck,
  evaluatePanel,
  evaluateMode,
  geometryCheckResult,
  onRunCheckGeometry,
  feaSettings,
  feaMesh,
  feaResult,
  feaPickTarget,
  onSetFeaPickTarget,
  onUpdateFeaSettings,
  onGenerateFeaMesh,
  onRunFeaSolve,
  onDeleteSupport,
  onDeleteLoad,
}) => {
  const [newRectW, setNewRectW] = useState(40);
  const [newRectH, setNewRectH] = useState(25);
  const [newCircR, setNewCircR] = useState(10);

  const mat = getMaterialById(feaSettings.materialId);

  const momentsOfInertia = useMemo(() => {
    if (!partMesh || partMesh.indices.length < 3) return null;
    return computeMomentsOfInertia(
      partMesh.positions,
      partMesh.indices,
      partMesh.centerOfMass,
      mat.density
    );
  }, [partMesh, mat.density]);

  // 1. Reference Geometry Inspector
  const selectedRef =
    selectedItem?.kind === 'ref'
      ? (part.referenceGeometries ?? []).find((r) => r.id === selectedItem.refId) ?? null
      : null;

  if (
    selectedRef &&
    !featureDraft &&
    !activeSketch &&
    (activeTab === 'reference' || activeTab === 'features')
  ) {
    return (
      <div className="p-3 space-y-2.5 text-xs" data-testid="property-reference-editor">
        <div className="font-semibold text-[#F0F6FC]">Referans: {selectedRef.name}</div>
        {selectedRef.kind === 'plane' && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Temel Düzlem</label>
              <select
                value={selectedRef.basePlane}
                onChange={(e) =>
                  onUpdateReferenceGeometry({
                    ...selectedRef,
                    basePlane: e.target.value as 'front' | 'top' | 'right',
                  })
                }
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="front">Front Plane (XY)</option>
                <option value="top">Top Plane (XZ)</option>
                <option value="right">Right Plane (YZ)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Ofset Mesafesi (mm)</label>
              <input
                type="number"
                value={selectedRef.offset}
                onChange={(e) =>
                  onUpdateReferenceGeometry({
                    ...selectedRef,
                    offset: Number(e.target.value) || 0,
                  })
                }
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
          </>
        )}
        {selectedRef.kind === 'axis' && (
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
              <label key={lbl} className="text-[10px] text-[#8B98AA]">
                Orig {lbl}
                <input
                  type="number"
                  value={selectedRef.origin[i]}
                  onChange={(e) => {
                    const next: [number, number, number] = [...selectedRef.origin];
                    next[i] = Number(e.target.value) || 0;
                    onUpdateReferenceGeometry({ ...selectedRef, origin: next });
                  }}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            ))}
          </div>
        )}
        {selectedRef.kind === 'point' && (
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
              <label key={lbl} className="text-[10px] text-[#8B98AA]">
                {lbl} (mm)
                <input
                  type="number"
                  value={selectedRef.position[i]}
                  onChange={(e) => {
                    const next: [number, number, number] = [...selectedRef.position];
                    next[i] = Number(e.target.value) || 0;
                    onUpdateReferenceGeometry({ ...selectedRef, position: next });
                  }}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            ))}
          </div>
        )}
        {selectedRef.kind === 'coord_sys' && (
          <div className="grid grid-cols-3 gap-1">
            {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
              <label key={lbl} className="text-[10px] text-[#8B98AA]">
                Orijin {lbl}
                <input
                  type="number"
                  value={selectedRef.origin[i]}
                  onChange={(e) => {
                    const next: [number, number, number] = [...selectedRef.origin];
                    next[i] = Number(e.target.value) || 0;
                    onUpdateReferenceGeometry({ ...selectedRef, origin: next });
                  }}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 2. Feature Creation / Editing Form (all 17 features)
  const editingFeature =
    featureDraft?.feature ??
    (selectedItem?.kind === 'feature'
      ? part.features.find((f) => f.id === selectedItem.featureId) ?? null
      : null);

  if (featureDraft || (activeTab === 'features' && editingFeature)) {
    const f = featureDraft ? featureDraft.feature : editingFeature!;
    const updateField = (patch: Partial<CadFeature>) => {
      if (featureDraft) {
        onChangeFeatureDraft({ ...featureDraft, feature: { ...f, ...patch } });
      } else {
        onUpdateExistingFeature({ ...f, ...patch });
      }
    };

    return (
      <div className="p-3 space-y-2.5 text-xs" data-testid="property-feature-editor">
        <div className="font-semibold text-[#F0F6FC] flex items-center justify-between">
          <span>{featureDraft ? `Yeni Unsur: ${f.name}` : `Düzenle: ${f.name}`}</span>
        </div>

        {(f.type === 'extrude_boss' ||
          f.type === 'extrude_cut' ||
          f.type === 'revolve' ||
          f.type === 'revolve_cut' ||
          f.type === 'swept_boss' ||
          f.type === 'swept_cut' ||
          f.type === 'rib') && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">
              {f.type === 'swept_boss' || f.type === 'swept_cut' ? 'Profil Eskizi' : 'Kaynak Eskiz'}
            </label>
            <select
              value={f.sketchId ?? part.sketches[0]?.id ?? ''}
              onChange={(e) => updateField({ sketchId: e.target.value })}
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
            >
              {part.sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {(f.type === 'swept_boss' || f.type === 'swept_cut') && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">Yol Eskizi (Path)</label>
            <select
              value={f.pathSketchId ?? ''}
              onChange={(e) => updateField({ pathSketchId: e.target.value || undefined })}
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
            >
              <option value="">Otomatik 3B Yol (35 mm)</option>
              {part.sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {f.type === 'loft_boss' && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">
              Loft Profilleri (≥1 Eskiz Seçin)
            </label>
            <div className="space-y-1 bg-[#11151C] border border-[#2D3646] rounded p-2">
              {part.sketches.map((s) => {
                const selected = (f.profileSketchIds ?? [part.sketches[0]?.id]).includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 text-[#D5DEE8]">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const cur = f.profileSketchIds ?? (f.sketchId ? [f.sketchId] : []);
                        const next = e.target.checked
                          ? [...cur, s.id]
                          : cur.filter((id) => id !== s.id);
                        updateField({ profileSketchIds: next });
                      }}
                    />
                    <span>{s.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {(f.type === 'extrude_boss' || f.type === 'extrude_cut') && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Derinlik (mm)</label>
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={f.depth ?? 20}
                onChange={(e) => updateField({ depth: Math.max(0.5, Number(e.target.value)) })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
            {f.type === 'extrude_boss' && (
              <div>
                <label className="block text-[11px] text-[#8B98AA] mb-1">
                  Ekstrüzyon Draft Açısı (°)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  value={f.draftExtrudeDeg ?? 0}
                  onChange={(e) =>
                    updateField({
                      draftExtrudeDeg: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-[#C5D1DF]">
              <input
                type="checkbox"
                checked={Boolean(f.symmetric)}
                onChange={(e) => updateField({ symmetric: e.target.checked })}
              />
              <span>Simetrik (Mid Plane)</span>
            </label>
            {!f.symmetric && (
              <div>
                <label className="block text-[11px] text-[#8B98AA] mb-1">Yön</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateField({ direction: 1 })}
                    className={`py-1 rounded border text-xs ${
                      (f.direction ?? 1) === 1
                        ? 'bg-[#2F6FED] border-[#2F6FED] text-white'
                        : 'bg-[#11151C] border-[#2D3646] text-[#B8C4D4]'
                    }`}
                  >
                    +Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField({ direction: -1 })}
                    className={`py-1 rounded border text-xs ${
                      f.direction === -1
                        ? 'bg-[#2F6FED] border-[#2F6FED] text-white'
                        : 'bg-[#11151C] border-[#2D3646] text-[#B8C4D4]'
                    }`}
                  >
                    -Normal
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {(f.type === 'revolve' || f.type === 'revolve_cut') && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Dönme Açısı (°)</label>
              <input
                type="number"
                min={10}
                max={360}
                value={f.angleDeg ?? 360}
                onChange={(e) =>
                  updateField({ angleDeg: Math.max(10, Math.min(360, Number(e.target.value))) })
                }
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Dönme Ekseni</label>
              <select
                value={f.revolveAxis ?? 'y'}
                onChange={(e) => updateField({ revolveAxis: e.target.value as 'x' | 'y' })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="y">Dikey Eksen (V)</option>
                <option value="x">Yatay Eksen (U)</option>
              </select>
            </div>
          </>
        )}

        {f.type === 'hole_wizard' && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Delik Tipi (ISO)</label>
              <select
                value={f.holeStandard ?? 'counterbore'}
                onChange={(e) =>
                  updateField({ holeStandard: e.target.value as CadFeature['holeStandard'] })
                }
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="counterbore">Counterbore (Havşa Başlı)</option>
                <option value="countersink">Countersink (Konik Havşalı)</option>
                <option value="simple">Simple Hole (Düz Delik)</option>
                <option value="tapped">Tapped Hole (Dişli)</option>
              </select>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {HOLE_ISO_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() =>
                    updateField({
                      holeDiameter: p.d,
                      cboreDiameter: p.cbD,
                      cboreDepth: p.cbH,
                      csinkDiameter: p.csD,
                    })
                  }
                  className="py-1 rounded bg-[#1E2736] hover:bg-[#2F6FED] text-[#D5DEE8] hover:text-white text-[10px] font-mono-tabular"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-[#8B98AA]">
                Çap (mm)
                <input
                  type="number"
                  min={1}
                  value={f.holeDiameter ?? 9}
                  onChange={(e) => updateField({ holeDiameter: Math.max(1, Number(e.target.value)) })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
              <label className="text-[10px] text-[#8B98AA]">
                Derinlik (mm)
                <input
                  type="number"
                  min={2}
                  value={f.holeDepth ?? 25}
                  onChange={(e) => updateField({ holeDepth: Math.max(1, Number(e.target.value)) })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <label className="text-[10px] text-[#8B98AA]">
                X
                <input
                  type="number"
                  value={f.holeX ?? 45}
                  onChange={(e) => updateField({ holeX: Number(e.target.value) || 0 })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
              <label className="text-[10px] text-[#8B98AA]">
                Y
                <input
                  type="number"
                  value={f.holeY ?? 18}
                  onChange={(e) => updateField({ holeY: Number(e.target.value) || 0 })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
              <label className="text-[10px] text-[#8B98AA]">
                Z
                <input
                  type="number"
                  value={f.holeZ ?? 0}
                  onChange={(e) => updateField({ holeZ: Number(e.target.value) || 0 })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            </div>
          </>
        )}

        {(f.type === 'fillet' || f.type === 'chamfer') && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">
                {f.type === 'fillet' ? 'Radyus (mm)' : 'Pah Mesafesi (mm)'}
              </label>
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={f.type === 'fillet' ? f.radius ?? 5 : f.distance ?? 2}
                onChange={(e) => {
                  const v = Math.max(0.2, Number(e.target.value));
                  updateField(f.type === 'fillet' ? { radius: v } : { distance: v });
                }}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Kenar Seçimi</label>
              <select
                value={f.edgePreset ?? 'inner_fillet'}
                onChange={(e) =>
                  updateField({
                    edgePreset: e.target.value as CadFeature['edgePreset'],
                    edgeIds: undefined,
                  })
                }
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="inner_fillet">İç Köşe Kenarı (Otomatik)</option>
                <option value="top_edges">Üst Kenarlar</option>
                <option value="all_edges">Tüm Dış Kenarlar</option>
              </select>
              {selectedEdgeIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => updateField({ edgeIds: selectedEdgeIds, edgePreset: undefined })}
                  className="mt-1.5 w-full py-1 rounded bg-[#233247] hover:bg-[#2F6FED] text-[#C5D1DF] hover:text-white text-[11px]"
                >
                  Seçili {selectedEdgeIds.length} Kenarı Kullan
                </button>
              )}
            </div>
          </>
        )}

        {f.type === 'shell' && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Et Kalınlığı (mm)</label>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={f.thickness ?? 2.5}
                onChange={(e) => updateField({ thickness: Math.max(0.5, Number(e.target.value)) })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
            <label className="flex items-center gap-2 text-[#C5D1DF]">
              <input
                type="checkbox"
                checked={Boolean(f.shellOutward)}
                onChange={(e) => updateField({ shellOutward: e.target.checked })}
              />
              <span>Dışa Doğru Kabuk (Shell Outward)</span>
            </label>
            {selectedFaceIds.length > 0 && (
              <button
                type="button"
                onClick={() => updateField({ openFaceIds: [...selectedFaceIds] })}
                className="w-full py-1 rounded bg-[#233247] hover:bg-[#2F6FED] text-[#C5D1DF] hover:text-white text-[11px]"
              >
                Seçili {selectedFaceIds.length} Yüzeyi Açık Bırak
              </button>
            )}
          </>
        )}

        {f.type === 'draft' && (
          <>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Çekme Açısı (°)</label>
              <input
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={f.draftAngleDeg ?? 5}
                onChange={(e) => updateField({ draftAngleDeg: Number(e.target.value) || 5 })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Kalıp Çekme Ekseni</label>
              <select
                value={f.draftAxis ?? 'y'}
                onChange={(e) => updateField({ draftAxis: e.target.value as 'x' | 'y' | 'z' })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="y">Y Ekseni (Dikey)</option>
                <option value="x">X Ekseni</option>
                <option value="z">Z Ekseni</option>
              </select>
            </div>
          </>
        )}

        {f.type === 'rib' && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">Feder Kalınlığı (mm)</label>
            <input
              type="number"
              min={1}
              max={40}
              value={f.ribThickness ?? 8}
              onChange={(e) => updateField({ ribThickness: Math.max(1, Number(e.target.value)) })}
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
            />
          </div>
        )}

        {f.type === 'linear_pattern' && (
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-[#8B98AA]">
              Adet X
              <input
                type="number"
                min={1}
                max={8}
                value={f.patternCountX ?? 3}
                onChange={(e) => updateField({ patternCountX: Number(e.target.value) || 1 })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
              />
            </label>
            <label className="text-[10px] text-[#8B98AA]">
              Aralık X (mm)
              <input
                type="number"
                value={f.patternSpacingX ?? 35}
                onChange={(e) => updateField({ patternSpacingX: Number(e.target.value) || 20 })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
              />
            </label>
            <label className="text-[10px] text-[#8B98AA]">
              Adet Z
              <input
                type="number"
                min={1}
                max={6}
                value={f.patternCountY ?? 1}
                onChange={(e) => updateField({ patternCountY: Number(e.target.value) || 1 })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
              />
            </label>
            <label className="text-[10px] text-[#8B98AA]">
              Aralık Z (mm)
              <input
                type="number"
                value={f.patternSpacingY ?? 30}
                onChange={(e) => updateField({ patternSpacingY: Number(e.target.value) || 20 })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
              />
            </label>
          </div>
        )}

        {f.type === 'circular_pattern' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-[#8B98AA]">
                Adet
                <input
                  type="number"
                  min={2}
                  max={16}
                  value={f.circularCount ?? 4}
                  onChange={(e) => updateField({ circularCount: Math.max(2, Number(e.target.value)) })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
              <label className="text-[10px] text-[#8B98AA]">
                Toplam Açı (°)
                <input
                  type="number"
                  min={15}
                  max={360}
                  value={f.circularAngleDeg ?? 360}
                  onChange={(e) => updateField({ circularAngleDeg: Number(e.target.value) || 360 })}
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            </div>
            <div>
              <label className="block text-[11px] text-[#8B98AA] mb-1">Dönme Ekseni</label>
              <select
                value={f.patternAxis ?? 'y'}
                onChange={(e) => updateField({ patternAxis: e.target.value as 'x' | 'y' | 'z' })}
                className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
              >
                <option value="y">Y Ekseni</option>
                <option value="x">X Ekseni</option>
                <option value="z">Z Ekseni</option>
              </select>
            </div>
          </>
        )}

        {f.type === 'mirror' && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">Aynalama Düzlemi</label>
            <select
              value={f.mirrorPlane ?? 'right'}
              onChange={(e) =>
                updateField({ mirrorPlane: e.target.value as 'front' | 'top' | 'right' })
              }
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
            >
              <option value="right">Right Plane (YZ)</option>
              <option value="front">Front Plane (XY)</option>
              <option value="top">Top Plane (XZ)</option>
            </select>
          </div>
        )}

        {f.type === 'combine' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-[#8B98AA]">
                İşlem
                <select
                  value={f.combineOp ?? 'add'}
                  onChange={(e) =>
                    updateField({ combineOp: e.target.value as 'add' | 'subtract' | 'common' })
                  }
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs text-white"
                >
                  <option value="add">Birleştir (Add)</option>
                  <option value="subtract">Çıkar (Subtract)</option>
                  <option value="common">Kesişim (Common)</option>
                </select>
              </label>
              <label className="text-[10px] text-[#8B98AA]">
                Gövde Şekli
                <select
                  value={f.combinePrimShape ?? 'cylinder'}
                  onChange={(e) =>
                    updateField({
                      combinePrimShape: e.target.value as 'box' | 'cylinder' | 'sphere',
                    })
                  }
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs text-white"
                >
                  <option value="cylinder">Silindir</option>
                  <option value="box">Blok (Box)</option>
                  <option value="sphere">Küre</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['Genişlik', 'Yükseklik', 'Derinlik'] as const).map((lbl, i) => (
                <label key={lbl} className="text-[10px] text-[#8B98AA]">
                  {lbl}
                  <input
                    type="number"
                    value={(f.combineSize ?? [24, 32, 24])[i]}
                    onChange={(e) => {
                      const next: [number, number, number] = [...(f.combineSize ?? [24, 32, 24])];
                      next[i] = Math.max(2, Number(e.target.value) || 10);
                      updateField({ combineSize: next });
                    }}
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
              ))}
            </div>
          </>
        )}

        {featureDraft && (
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => onCommitFeatureDraft(featureDraft)}
              className="flex-1 py-1.5 rounded bg-[#2F6FED] hover:bg-[#255CE0] text-white font-medium"
            >
              Uygula
            </button>
            <button
              type="button"
              onClick={() => onChangeFeatureDraft(null)}
              className="px-3 py-1.5 rounded bg-[#232B38] hover:bg-[#2F394B] text-[#D5DEE8]"
            >
              İptal
            </button>
          </div>
        )}
      </div>
    );
  }

  // 3. Active 2D Sketch Inspector
  if (activeSketch) {
    const selectedEnt = activeSketch.entities.find((e) => e.id === selectedSketchEntityId);

    return (
      <div className="p-3 space-y-2.5 text-xs" data-testid="property-sketch-editor">
        <div className="font-semibold text-[#F0F6FC]">{activeSketch.name}</div>

        <div>
          <label className="block text-[11px] text-[#8B98AA] mb-1">Eskiz Düzlemi</label>
          <select
            value={activeSketch.planeId}
            onChange={(e) =>
              onUpdateSketchPlane(e.target.value as PlaneId, activeSketch.planeOffset ?? 0)
            }
            className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
          >
            <option value="front">Ön Düzlem (XY)</option>
            <option value="top">Üst Düzlem (XZ)</option>
            <option value="right">Sağ Düzlem (YZ)</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-[#8B98AA] mb-1">Düzlem Ofseti (mm)</label>
          <input
            type="number"
            value={activeSketch.planeOffset ?? 0}
            onChange={(e) =>
              onUpdateSketchPlane(activeSketch.planeId, Number(e.target.value) || 0)
            }
            className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
          />
        </div>

        <div className="pt-1.5 border-t border-[#232B38] space-y-1.5">
          <div className="text-[11px] font-medium text-[#9EB4CC]">Hızlı Geometri Ekle</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="number"
              value={newRectW}
              onChange={(e) => setNewRectW(Number(e.target.value) || 10)}
              aria-label="Dikdörtgen Genişlik"
              className="bg-[#11151C] border border-[#2D3646] rounded px-2 py-1 text-xs font-mono-tabular"
            />
            <input
              type="number"
              value={newRectH}
              onChange={(e) => setNewRectH(Number(e.target.value) || 10)}
              aria-label="Dikdörtgen Yükseklik"
              className="bg-[#11151C] border border-[#2D3646] rounded px-2 py-1 text-xs font-mono-tabular"
            />
          </div>
          <button
            type="button"
            onClick={() => onAddSketchEntityManual('rect')}
            className="w-full py-1.5 rounded bg-[#232E40] hover:bg-[#2F6FED] text-[#D5DEE8] hover:text-white"
          >
            Dikdörtgen Ekle ({newRectW}×{newRectH})
          </button>
          <div className="flex gap-1.5">
            <input
              type="number"
              value={newCircR}
              onChange={(e) => setNewCircR(Number(e.target.value) || 5)}
              aria-label="Daire Yarıçap"
              className="w-20 bg-[#11151C] border border-[#2D3646] rounded px-2 py-1 text-xs font-mono-tabular"
            />
            <button
              type="button"
              onClick={() => onAddSketchEntityManual('circle')}
              className="flex-1 py-1.5 rounded bg-[#232E40] hover:bg-[#2F6FED] text-[#D5DEE8] hover:text-white"
            >
              Daire (R{newCircR})
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onAddSketchEntityManual('polygon')}
              className="py-1 rounded bg-[#232E40] hover:bg-[#2F6FED] text-[#D5DEE8] hover:text-white text-[11px]"
            >
              + Altıgen (Polygon)
            </button>
            <button
              type="button"
              onClick={() => onAddSketchEntityManual('slot')}
              className="py-1 rounded bg-[#232E40] hover:bg-[#2F6FED] text-[#D5DEE8] hover:text-white text-[11px]"
            >
              + Kanal (Slot)
            </button>
          </div>
        </div>

        {selectedEnt && (
          <div className="pt-1.5 border-t border-[#232B38] space-y-1.5">
            <div className="text-[11px] font-medium text-[#60A5FA]">
              Seçili Geometri ({selectedEnt.type})
            </div>
            {(selectedEnt.type === 'circle' || selectedEnt.type === 'polygon') && (
              <div className="grid grid-cols-3 gap-1">
                <label className="text-[10px] text-[#8B98AA]">
                  CX
                  <input
                    type="number"
                    value={Math.round(selectedEnt.cx * 10) / 10}
                    onChange={(e) =>
                      onUpdateSketchEntityDim(selectedEnt.id, { cx: Number(e.target.value) })
                    }
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
                <label className="text-[10px] text-[#8B98AA]">
                  CY
                  <input
                    type="number"
                    value={Math.round(selectedEnt.cy * 10) / 10}
                    onChange={(e) =>
                      onUpdateSketchEntityDim(selectedEnt.id, { cy: Number(e.target.value) })
                    }
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
                <label className="text-[10px] text-[#8B98AA]">
                  R
                  <input
                    type="number"
                    min={0.5}
                    value={Math.round(selectedEnt.radius * 10) / 10}
                    onChange={(e) =>
                      onUpdateSketchEntityDim(selectedEnt.id, {
                        radius: Math.max(0.5, Number(e.target.value)),
                      })
                    }
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
              </div>
            )}
            {selectedEnt.type === 'polygon' && (
              <label className="block text-[10px] text-[#8B98AA]">
                Kenar Sayısı
                <input
                  type="number"
                  min={3}
                  max={24}
                  value={selectedEnt.sides}
                  onChange={(e) =>
                    onUpdateSketchEntityDim(selectedEnt.id, {
                      sides: Math.max(3, Math.round(Number(e.target.value))),
                    })
                  }
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            )}
            {selectedEnt.type === 'rect' && (
              <div className="grid grid-cols-2 gap-1.5">
                <label className="text-[10px] text-[#8B98AA]">
                  Genişlik (mm)
                  <input
                    type="number"
                    min={1}
                    value={Math.round(selectedEnt.width * 10) / 10}
                    onChange={(e) =>
                      onUpdateSketchEntityDim(selectedEnt.id, { width: Number(e.target.value) })
                    }
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
                <label className="text-[10px] text-[#8B98AA]">
                  Yükseklik (mm)
                  <input
                    type="number"
                    min={1}
                    value={Math.round(selectedEnt.height * 10) / 10}
                    onChange={(e) =>
                      onUpdateSketchEntityDim(selectedEnt.id, { height: Number(e.target.value) })
                    }
                    className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                  />
                </label>
              </div>
            )}
            {selectedEnt.type === 'slot' && (
              <label className="block text-[10px] text-[#8B98AA]">
                Slot Yarıçapı (mm)
                <input
                  type="number"
                  min={1}
                  value={Math.round(selectedEnt.radius * 10) / 10}
                  onChange={(e) =>
                    onUpdateSketchEntityDim(selectedEnt.id, {
                      radius: Math.max(1, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                />
              </label>
            )}
          </div>
        )}

        {activeSketch.constraints.length > 0 && (
          <div className="pt-1.5 border-t border-[#232B38] space-y-1">
            <div className="text-[11px] font-medium text-[#8B98AA]">
              Kısıtlar ({activeSketch.constraints.length})
            </div>
            {activeSketch.constraints.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-[#11151C] px-2 py-1 rounded text-[10px]"
              >
                <span className="text-[#C5D1DF] font-mono-tabular">
                  {c.type}
                  {c.type === 'dimension' ? ` = ${c.value}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteSketchConstraint(c.id)}
                  className="text-[#F87171] hover:underline"
                >
                  Sil
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 4. Assembly Mate Builder
  if (activeTab === 'assembly' && mateDraft) {
    return (
      <div className="p-3 space-y-2.5 text-xs" data-testid="property-mate-editor">
        <div className="font-semibold text-[#F0F6FC]">
          Montaj İlişkisi: {mateDraft.type.toUpperCase()}
        </div>

        <div>
          <label className="block text-[11px] text-[#8B98AA] mb-1">1. Bileşen (Referans)</label>
          <select
            value={mateDraft.componentAId}
            onChange={(e) =>
              onChangeMateDraft({ ...mateDraft, componentAId: e.target.value })
            }
            className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[11px] text-[#9AA8BA] font-mono-tabular">
              Yüzey #{mateDraft.faceAId}
            </span>
            <button
              type="button"
              onClick={() => onChangeMateDraft({ ...mateDraft, pickingTarget: 'A' })}
              className={`ml-auto px-2 py-0.5 rounded text-[11px] ${
                mateDraft.pickingTarget === 'A'
                  ? 'bg-[#2F6FED] text-white'
                  : 'bg-[#232B38] text-[#C5D1DF]'
              }`}
            >
              3D&apos;den Seç
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-[#8B98AA] mb-1">2. Bileşen (Taşınacak)</label>
          <select
            value={mateDraft.componentBId}
            onChange={(e) =>
              onChangeMateDraft({ ...mateDraft, componentBId: e.target.value })
            }
            className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[11px] text-[#9AA8BA] font-mono-tabular">
              Yüzey #{mateDraft.faceBId}
            </span>
            <button
              type="button"
              onClick={() => onChangeMateDraft({ ...mateDraft, pickingTarget: 'B' })}
              className={`ml-auto px-2 py-0.5 rounded text-[11px] ${
                mateDraft.pickingTarget === 'B'
                  ? 'bg-[#2F6FED] text-white'
                  : 'bg-[#232B38] text-[#C5D1DF]'
              }`}
            >
              3D&apos;den Seç
            </button>
          </div>
        </div>

        {mateDraft.type === 'distance' && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">Mesafe (mm)</label>
            <input
              type="number"
              value={mateDraft.distanceValue}
              onChange={(e) =>
                onChangeMateDraft({
                  ...mateDraft,
                  distanceValue: Number(e.target.value) || 0,
                })
              }
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
            />
          </div>
        )}

        {mateDraft.type === 'angle' && (
          <div>
            <label className="block text-[11px] text-[#8B98AA] mb-1">Açı (°)</label>
            <input
              type="number"
              min={0}
              max={180}
              value={mateDraft.angleValue}
              onChange={(e) =>
                onChangeMateDraft({
                  ...mateDraft,
                  angleValue: Number(e.target.value) || 0,
                })
              }
              className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs font-mono-tabular text-[#E6EDF3]"
            />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onCommitMateDraft(mateDraft)}
            className="flex-1 py-1.5 rounded bg-[#2F6FED] hover:bg-[#255CE0] text-white font-medium"
          >
            Mate Uygula
          </button>
          <button
            type="button"
            onClick={() => onChangeMateDraft(null)}
            className="px-3 py-1.5 rounded bg-[#232B38] text-[#D5DEE8]"
          >
            İptal
          </button>
        </div>
      </div>
    );
  }

  // 5. Assembly Sub-Panels (Move/Rotate, Exploded View, Interference, BOM)
  if (activeTab === 'assembly' && assemblyPanel) {
    if (assemblyPanel === 'explode') {
      return (
        <div className="p-3 space-y-2.5 text-xs" data-testid="property-assembly-explode">
          <div className="font-semibold text-[#F0F6FC]">Patlatılmış Görünüm (Exploded View)</div>
          <div className="flex items-center justify-between text-[11px] text-[#9AA8BA]">
            <span>Patlatma Faktörü</span>
            <span className="font-mono-tabular text-white">
              {Math.round(explodeFactor * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={explodeFactor}
            onChange={(e) => onChangeExplodeFactor(Number(e.target.value))}
            className="w-full accent-[#D97706]"
          />
          <button
            type="button"
            onClick={() => onChangeExplodeFactor(explodeFactor > 0 ? 0 : 1)}
            className="w-full py-1.5 rounded bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3]"
          >
            {explodeFactor > 0 ? 'Montajı Topla (Collapse)' : 'Otomatik Patlat (100%)'}
          </button>
        </div>
      );
    }

    if (assemblyPanel === 'interference') {
      return (
        <div className="p-3 space-y-2.5 text-xs" data-testid="property-assembly-interference">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#F0F6FC]">Çakışma Analizi (Interference)</span>
            <button
              type="button"
              onClick={onRunInterferenceCheck}
              className="text-[11px] text-[#60A5FA] hover:underline"
            >
              Tara
            </button>
          </div>
          {interferencePairs === null ? (
            <div className="text-[#8B98AA]">Taramayı başlatın...</div>
          ) : interferencePairs.length === 0 ? (
            <div className="p-2.5 rounded bg-[#142922] border border-[#1E6B4F] text-[#6EE7B7]">
              Çakışma bulunamadı (0 girişim).
            </div>
          ) : (
            <div className="space-y-1.5">
              {interferencePairs.map((pair, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded bg-[#361F22] border border-[#7F1D1D] text-[#FECACA] space-y-0.5 font-mono-tabular text-[11px]"
                >
                  <div className="font-semibold">
                    {pair.componentAName} × {pair.componentBName}
                  </div>
                  <div className="text-[10px]">
                    Girişim Hacmi: {pair.overlapVolumeCm3.toFixed(3)} cm³
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (assemblyPanel === 'bom') {
      const counts = new Map<string, { part: PartDefinition; qty: number }>();
      for (const comp of components) {
        const pDef = parts.find((p) => p.id === comp.partId);
        if (!pDef) continue;
        const cur = counts.get(pDef.id);
        if (cur) cur.qty++;
        else counts.set(pDef.id, { part: pDef, qty: 1 });
      }
      const rows = Array.from(counts.values());
      return (
        <div className="p-3 space-y-2 text-xs" data-testid="property-assembly-bom">
          <div className="font-semibold text-[#F0F6FC]">Malzeme Listesi (BOM)</div>
          <div className="border border-[#263042] rounded overflow-hidden">
            <table className="w-full text-[10px] font-mono-tabular text-left">
              <thead className="bg-[#1B2330] text-[#9EB4CC]">
                <tr>
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">Parça</th>
                  <th className="px-2 py-1">Adet</th>
                  <th className="px-2 py-1">Kütle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const m = partMeshes[r.part.id];
                  const massKg = m ? (m.volume * 1e-9) * mat.density * r.qty : 0;
                  return (
                    <tr key={r.part.id} className="border-t border-[#232B38] text-[#E6EDF3]">
                      <td className="px-2 py-1">{i + 1}</td>
                      <td className="px-2 py-1 font-sans">{r.part.name}</td>
                      <td className="px-2 py-1">{r.qty}</td>
                      <td className="px-2 py-1">{massKg.toFixed(3)} kg</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Move / Rotate Component
    const selectedComp =
      (selectedItem?.kind === 'component'
        ? components.find((c) => c.id === selectedItem.componentId)
        : null) ??
      components.find((c) => !c.fixed) ??
      components[0];

    if (selectedComp) {
      return (
        <div className="p-3 space-y-2.5 text-xs" data-testid="property-assembly-move">
          <div className="font-semibold text-[#F0F6FC]">
            Bileşen Taşı / Döndür: {selectedComp.name}
          </div>
          {selectedComp.fixed ? (
            <div className="text-[11px] text-[#FBBF24]">
              Bu bileşen sabitlenmiştir (f). Hareketli bileşeni soldaki ağaçtan seçin.
            </div>
          ) : (
            <>
              <div className="text-[10px] text-[#8B98AA]">Pozisyon (mm)</div>
              <div className="grid grid-cols-3 gap-1">
                {(['X', 'Y', 'Z'] as const).map((lbl, i) => (
                  <label key={lbl} className="text-[10px] text-[#8B98AA]">
                    {lbl}
                    <input
                      type="number"
                      value={Math.round(selectedComp.position[i] * 10) / 10}
                      onChange={(e) => {
                        const pos: [number, number, number] = [...selectedComp.position];
                        pos[i] = Number(e.target.value) || 0;
                        onUpdateComponentTransform(selectedComp.id, pos, selectedComp.rotationEuler);
                      }}
                      className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                    />
                  </label>
                ))}
              </div>
              <div className="text-[10px] text-[#8B98AA]">Rotasyon (°)</div>
              <div className="grid grid-cols-3 gap-1">
                {(['RX', 'RY', 'RZ'] as const).map((lbl, i) => (
                  <label key={lbl} className="text-[10px] text-[#8B98AA]">
                    {lbl}
                    <input
                      type="number"
                      value={Math.round(selectedComp.rotationEuler[i] * 10) / 10}
                      onChange={(e) => {
                        const rot: [number, number, number] = [...selectedComp.rotationEuler];
                        rot[i] = Number(e.target.value) || 0;
                        onUpdateComponentTransform(selectedComp.id, selectedComp.position, rot);
                      }}
                      className="w-full bg-[#11151C] border border-[#2D3646] rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }
  }

  // 6. FEA Inspector
  if (activeTab === 'fea') {
    return (
      <div className="p-3 space-y-3 text-xs" data-testid="property-fea-inspector">
        <div>
          <label className="block text-[11px] text-[#8B98AA] mb-1">
            Mühendislik Malzemesi
          </label>
          <select
            value={feaSettings.materialId}
            onChange={(e) => onUpdateFeaSettings({ materialId: e.target.value })}
            className="w-full bg-[#11151C] border border-[#2D3646] rounded px-2 py-1.5 text-xs text-[#E6EDF3]"
          >
            {MATERIAL_LIBRARY.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nameTr}
              </option>
            ))}
          </select>
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono-tabular text-[#9AA8BA] bg-[#121720] p-2 rounded border border-[#232B38]">
            <span>E = {(mat.elasticModulus / 1e9).toFixed(1)} GPa</span>
            <span>ν = {mat.poissonRatio}</span>
            <span>σy = {(mat.yieldStrength / 1e6).toFixed(0)} MPa</span>
            <span>ρ = {mat.density} kg/m³</span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[#8B98AA]">Sonlu Elemanlar Ağı (Mesh)</span>
            <button
              type="button"
              onClick={onGenerateFeaMesh}
              className="text-[11px] text-[#60A5FA] hover:underline"
            >
              Ağı Üret
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(['coarse', 'medium', 'fine'] as const).map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => onUpdateFeaSettings({ meshResolution: res })}
                className={`py-1 rounded text-[11px] border ${
                  feaSettings.meshResolution === res
                    ? 'bg-[#2F6FED] border-[#2F6FED] text-white'
                    : 'bg-[#11151C] border-[#2D3646] text-[#B8C4D4]'
                }`}
              >
                {res === 'coarse' ? 'Kaba' : res === 'medium' ? 'Orta' : 'İnce'}
              </button>
            ))}
          </div>
          {feaMesh && (
            <div className="mt-1 text-[10px] font-mono-tabular text-[#9AA8BA]">
              {feaMesh.nodeCount} Düğüm · {feaMesh.elementCount} Tetrahedral Eleman
            </div>
          )}
        </div>

        <div className="space-y-2 pt-1.5 border-t border-[#232B38]">
          {feaSettings.supports.map((sup) => (
            <div key={sup.id} className="bg-[#121720] border border-[#25362E] rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#34D399]">{sup.name}</span>
                {feaSettings.supports.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteSupport(sup.id)}
                    className="text-[10px] text-[#F87171] hover:underline"
                  >
                    Sil
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#9AA8BA]">
                <span className="font-mono-tabular">
                  Yüzeyler: {sup.faceIds.length > 0 ? sup.faceIds.join(', ') : 'Seçilmedi'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onSetFeaPickTarget(
                      feaPickTarget?.id === sup.id ? null : { kind: 'support', id: sup.id }
                    )
                  }
                  className={`px-2 py-0.5 rounded ${
                    feaPickTarget?.id === sup.id
                      ? 'bg-[#1E7E50] text-white'
                      : 'bg-[#1D2838] text-[#C5D1DF]'
                  }`}
                >
                  {feaPickTarget?.id === sup.id ? 'Yüzeye Tıkla...' : 'Yüzey Seç'}
                </button>
              </div>
            </div>
          ))}

          {feaSettings.loads.map((load) => (
            <div key={load.id} className="bg-[#121720] border border-[#3B262B] rounded p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#F87171]">{load.name}</span>
                {feaSettings.loads.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteLoad(load.id)}
                    className="text-[10px] text-[#F87171] hover:underline"
                  >
                    Sil
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={load.type}
                  onChange={(e) => {
                    const nextLoads = feaSettings.loads.map((l) =>
                      l.id === load.id
                        ? { ...l, type: e.target.value as 'force' | 'pressure' }
                        : l
                    );
                    onUpdateFeaSettings({ loads: nextLoads });
                  }}
                  className="bg-[#181E28] border border-[#2D3646] rounded px-1.5 py-1 text-[11px]"
                >
                  <option value="force">Force (N)</option>
                  <option value="pressure">Pressure (MPa)</option>
                </select>
                <input
                  type="number"
                  value={load.magnitude}
                  onChange={(e) => {
                    const nextLoads = feaSettings.loads.map((l) =>
                      l.id === load.id ? { ...l, magnitude: Number(e.target.value) || 0 } : l
                    );
                    onUpdateFeaSettings({ loads: nextLoads });
                  }}
                  className="bg-[#181E28] border border-[#2D3646] rounded px-1.5 py-1 text-[11px] font-mono-tabular"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#9AA8BA]">
                <span className="font-mono-tabular">
                  Yüzeyler: {load.faceIds.length > 0 ? load.faceIds.join(', ') : 'Seçilmedi'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onSetFeaPickTarget(
                      feaPickTarget?.id === load.id ? null : { kind: 'load', id: load.id }
                    )
                  }
                  className={`px-2 py-0.5 rounded ${
                    feaPickTarget?.id === load.id
                      ? 'bg-[#C2410C] text-white'
                      : 'bg-[#1D2838] text-[#C5D1DF]'
                  }`}
                >
                  {feaPickTarget?.id === load.id ? 'Yüzeye Tıkla...' : 'Yüzey Seç'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {feaResult && (
          <div className="pt-1.5 border-t border-[#232B38] space-y-1.5">
            <label className="flex items-center justify-between text-[11px] text-[#9AA8BA]">
              <span>Deformasyon Ölçeği</span>
              <span className="font-mono-tabular text-white">
                {feaSettings.deformationScale === 0 ? 'Gerçek (0x)' : `${feaSettings.deformationScale.toFixed(1)}x`}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={3}
              step={0.2}
              value={feaSettings.deformationScale}
              onChange={(e) =>
                onUpdateFeaSettings({ deformationScale: Number(e.target.value) })
              }
              className="w-full accent-[#2F6FED]"
            />
          </div>
        )}

        <button
          type="button"
          onClick={onRunFeaSolve}
          className="w-full py-2 rounded bg-[#2F6FED] hover:bg-[#255CE0] text-white font-semibold"
        >
          Statik Analizi Çöz (Solve)
        </button>
      </div>
    );
  }

  // 7. Evaluate / Check Geometry / Mass Properties / Measure
  if (activeTab === 'evaluate' && evaluatePanel === 'check_geometry') {
    return (
      <div className="p-3 space-y-2.5 text-xs" data-testid="property-check-geometry">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#F0F6FC]">Geometri Kontrolü (B-Rep Check)</span>
          <button
            type="button"
            onClick={onRunCheckGeometry}
            className="text-[11px] text-[#60A5FA] hover:underline"
          >
            Kontrol Et
          </button>
        </div>
        {geometryCheckResult ? (
          <div
            className={`p-2.5 rounded border space-y-1.5 ${
              geometryCheckResult.isValid
                ? 'bg-[#142922] border-[#1E6B4F] text-[#A7F3D0]'
                : 'bg-[#361F22] border-[#7F1D1D] text-[#FECACA]'
            }`}
          >
            <div className="font-semibold">
              {geometryCheckResult.isValid ? 'Geçerli B-Rep Katı Model' : 'Geometri Uyarısı'}
            </div>
            <div className="text-[11px] opacity-90">{geometryCheckResult.summary}</div>
            <div className="grid grid-cols-2 gap-1 pt-1 text-[10px] font-mono-tabular">
              <span>Yüzey: {geometryCheckResult.faceCount}</span>
              <span>Kenar: {geometryCheckResult.edgeCount}</span>
              <span>Köşe: {geometryCheckResult.vertexCount}</span>
              <span>Üçgen: {geometryCheckResult.triangleCount}</span>
            </div>
          </div>
        ) : (
          <div className="text-[#8B98AA]">OpenCascade BRepCheck_Analyzer çalıştırılıyor...</div>
        )}
      </div>
    );
  }

  const volumeCm3 = partMesh ? partMesh.volume / 1000 : 0;
  const massKg = volumeCm3 * 1e-6 * mat.density;
  const areaCm2 = partMesh ? partMesh.surfaceArea / 100 : 0;
  const twoSelectedFaces =
    partMesh && selectedFaceIds.length >= 2
      ? selectedFaceIds
          .slice(0, 2)
          .map((id) => partMesh.faceInfos.find((fi) => fi.faceId === id))
          .filter(Boolean)
      : [];

  return (
    <div className="p-3 space-y-2.5 text-xs" data-testid="property-evaluate">
      <div className="font-semibold text-[#F0F6FC]">
        {activeTab === 'evaluate'
          ? evaluatePanel === 'mass'
            ? 'Kütle & Atalet Özellikleri'
            : 'Ölçüm & Geometri Analizi'
          : 'Model Özellikleri'}
      </div>

      {evaluateMode === 'draft_analysis' && (
        <div className="bg-[#121720] border border-[#233247] rounded p-2 text-[10px] space-y-1">
          <div className="font-semibold text-[#E6EDF3]">Draft Analizi (Y Çekme Ekseni)</div>
          <div className="flex items-center gap-2 text-[#6EE7B7]">● Pozitif Açılı Yüzey (&gt; +1°)</div>
          <div className="flex items-center gap-2 text-[#FDE047]">● Dik Duvar (0° ± 1°)</div>
          <div className="flex items-center gap-2 text-[#FCA5A5]">● Negatif / Alt Kesim (Undercut)</div>
        </div>
      )}

      {evaluateMode === 'curvature' && (
        <div className="bg-[#121720] border border-[#312347] rounded p-2 text-[10px] space-y-1">
          <div className="font-semibold text-[#E6EDF3]">Eğrilik Analizi (1 / R)</div>
          <div className="text-[#93C5FD]">Düzlem Yüzey: K = 0</div>
          <div className="text-[#FDBA74]">Radyus / Silindirik Eğrilik: Isı Skalası</div>
        </div>
      )}

      {partMesh ? (
        <div className="space-y-1.5 bg-[#121720] border border-[#232B38] rounded p-2.5 font-mono-tabular text-[11px]">
          <div className="flex justify-between">
            <span className="text-[#8B98AA]">Hacim:</span>
            <span className="text-[#E6EDF3]">{volumeCm3.toFixed(2)} cm³</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98AA]">Yüzey Alanı:</span>
            <span className="text-[#E6EDF3]">{areaCm2.toFixed(2)} cm²</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98AA]">Kütle ({mat.name.split(' ')[0]}):</span>
            <span className="text-[#E6EDF3]">{massKg.toFixed(3)} kg</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8B98AA]">Ağırlık Merkezi:</span>
            <span className="text-[#E6EDF3]">
              ({partMesh.centerOfMass.map((v) => v.toFixed(1)).join(', ')})
            </span>
          </div>
          {momentsOfInertia && (
            <div className="pt-1 border-t border-[#1F2735] space-y-0.5 text-[10px] text-[#A5B4FC]">
              <div className="flex justify-between">
                <span>Ixx:</span>
                <span>{momentsOfInertia.Ixx.toFixed(1)} kg·mm²</span>
              </div>
              <div className="flex justify-between">
                <span>Iyy:</span>
                <span>{momentsOfInertia.Iyy.toFixed(1)} kg·mm²</span>
              </div>
              <div className="flex justify-between">
                <span>Izz:</span>
                <span>{momentsOfInertia.Izz.toFixed(1)} kg·mm²</span>
              </div>
            </div>
          )}
          <div className="flex justify-between pt-1 border-t border-[#1F2735]">
            <span className="text-[#8B98AA]">Çekirdek:</span>
            <span className="text-[#60A5FA]">
              {partMesh.kernelSource === 'opencascade' ? 'OpenCascade WASM' : 'B-Rep Mesh'}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-[#8B98AA]">Geometri yükleniyor...</div>
      )}

      <div className="bg-[#121720] border border-[#232B38] rounded px-2.5 py-1.5 flex items-center justify-between text-[11px]">
        <span className="text-[#8B98AA]">Aktif Seçim Filtresi:</span>
        <span className="font-mono-tabular font-medium text-[#60A5FA]">
          {selectionFilter === 'face'
            ? 'Face (Yüzey)'
            : selectionFilter === 'edge'
            ? 'Edge (Kenar)'
            : 'Vertex (Köşe)'}
        </span>
      </div>

      {selectedFaceIds.length > 0 && (
        <div
          className="bg-[#172231] border border-[#2A3F5F] rounded p-2 text-[11px] font-mono-tabular text-[#BAE6FD] space-y-0.5"
          data-testid="selected-faces-info"
        >
          <div>Seçili Yüzey: #{selectedFaceIds.join(', #')}</div>
          {partMesh?.faceInfos
            .filter((fi) => selectedFaceIds.includes(fi.faceId))
            .slice(0, 2)
            .map((fi) => (
              <div key={fi.faceId} className="text-[10px] text-[#93C5FD]">
                Alan: {(fi.area / 100).toFixed(2)} cm² · N: (
                {fi.normal.map((v) => v.toFixed(2)).join(', ')})
              </div>
            ))}
          {twoSelectedFaces.length === 2 && twoSelectedFaces[0] && twoSelectedFaces[1] && (
            <div className="text-[10px] text-white pt-0.5 border-t border-[#2A3F5F]">
              İki Yüzey Açısı: {measureFacesAngleDeg(twoSelectedFaces[0], twoSelectedFaces[1]).toFixed(1)}°
            </div>
          )}
        </div>
      )}

      {selectedEdgeIds.length > 0 && (
        <div
          className="bg-[#172231] border border-[#2A3F5F] rounded p-2 text-[11px] font-mono-tabular text-[#BAE6FD] space-y-0.5"
          data-testid="selected-edges-info"
        >
          <div>Seçili Kenar: #{selectedEdgeIds.join(', #')}</div>
          {partMesh && (
            <div className="text-[10px] text-[#93C5FD]">
              Toplam Uzunluk:{' '}
              {partMesh.edgeInfos
                .filter((ei) => selectedEdgeIds.includes(ei.edgeId))
                .reduce((acc, ei) => acc + ei.length, 0)
                .toFixed(2)}{' '}
              mm
            </div>
          )}
        </div>
      )}

      {selectedVertexIds.length > 0 && (
        <div
          className="bg-[#231D12] border border-[#594218] rounded p-2 text-[11px] font-mono-tabular text-[#FDE68A] space-y-0.5"
          data-testid="selected-vertices-info"
        >
          <div>Seçili Köşe (Vertex): #{selectedVertexIds.join(', #')}</div>
          {partMesh &&
            selectedVertexIds.slice(0, 3).map((vid) => {
              const v = partMesh.vertexInfos[vid];
              if (!v) return null;
              return (
                <div key={vid} className="text-[10px] text-[#FCD34D]">
                  V#{vid}: ({v.position.map((n) => n.toFixed(1)).join(', ')}) mm
                </div>
              );
            })}
          {partMesh &&
            selectedVertexIds.length >= 2 &&
            partMesh.vertexInfos[selectedVertexIds[0]] &&
            partMesh.vertexInfos[selectedVertexIds[1]] && (
              <div className="text-[10px] text-white pt-0.5 border-t border-[#594218]">
                İki Köşe Mesafesi:{' '}
                {distanceBetweenPoints(
                  partMesh.vertexInfos[selectedVertexIds[0]].position,
                  partMesh.vertexInfos[selectedVertexIds[1]].position
                ).toFixed(2)}{' '}
                mm
              </div>
            )}
        </div>
      )}
    </div>
  );
};
