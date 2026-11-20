import React from 'react';
import {
  AssemblyComponent,
  AssemblyMate,
  CadFeature,
  CommandTab,
  FeaMeshData,
  FeaResult,
  FeaSettings,
  PartDefinition,
  PlaneId,
  SketchData,
} from '../types/cad';
import { getMaterialById } from '../data/materials';
import {
  Box,
  Compass,
  PenTool,
  Layers,
  Eye,
  EyeOff,
  Trash2,
  Edit3,
  Activity,
  Grid,
  Anchor,
  ArrowDownToLine,
  ShieldCheck,
  FolderTree,
  Axis3d,
  MapPin,
} from 'lucide-react';

export type SelectedTreeItem =
  | { kind: 'origin' }
  | { kind: 'plane'; planeId: PlaneId }
  | { kind: 'ref'; refId: string }
  | { kind: 'sketch'; sketchId: string }
  | { kind: 'feature'; featureId: string }
  | { kind: 'component'; componentId: string }
  | { kind: 'mate'; mateId: string }
  | { kind: 'fea_geometry' }
  | { kind: 'fea_material' }
  | { kind: 'fea_mesh' }
  | { kind: 'fea_support'; supportId: string }
  | { kind: 'fea_load'; loadId: string }
  | { kind: 'fea_solution'; mode: FeaSettings['resultMode'] };

interface FeatureTreeProps {
  activeTab: CommandTab;
  part: PartDefinition;
  components: AssemblyComponent[];
  mates: AssemblyMate[];
  feaSettings: FeaSettings;
  feaMesh: FeaMeshData | null;
  feaResult: FeaResult | null;
  selectedItem: SelectedTreeItem | null;
  onSelectItem: (item: SelectedTreeItem) => void;
  onEditSketch: (sketch: SketchData) => void;
  onToggleFeatureSuppress: (featureId: string) => void;
  onDeleteFeature: (featureId: string) => void;
  onDeleteSketch: (sketchId: string) => void;
  onDeleteReferenceGeometry: (refId: string) => void;
  onDeleteComponent: (compId: string) => void;
  onDeleteMate: (mateId: string) => void;
  onSelectFeaResultMode: (mode: FeaSettings['resultMode']) => void;
}

export const FeatureTree: React.FC<FeatureTreeProps> = ({
  activeTab,
  part,
  components,
  mates,
  feaSettings,
  feaMesh,
  feaResult,
  selectedItem,
  onSelectItem,
  onEditSketch,
  onToggleFeatureSuppress,
  onDeleteFeature,
  onDeleteSketch,
  onDeleteReferenceGeometry,
  onDeleteComponent,
  onDeleteMate,
  onSelectFeaResultMode,
}) => {
  const mat = getMaterialById(feaSettings.materialId);

  if (activeTab === 'fea') {
    return (
      <div className="p-2.5 space-y-1 text-xs" data-testid="ansys-analysis-tree">
        <div className="px-2 py-1.5 text-[11px] font-semibold text-[#8EA0B5] flex items-center gap-1.5 border-b border-[#252D3B] mb-1.5">
          <Activity className="w-3.5 h-3.5 text-[#60A5FA]" />
          <span>Ansys Yapısal Analiz Ağacı</span>
        </div>

        <button
          type="button"
          onClick={() => onSelectItem({ kind: 'fea_geometry' })}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
            selectedItem?.kind === 'fea_geometry'
              ? 'bg-[#253B5E] text-white'
              : 'text-[#D5DEE8] hover:bg-[#1E2531]'
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Box className="w-3.5 h-3.5 text-[#93C5FD] shrink-0" />
            <span className="truncate">Geometry ({part.name})</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectItem({ kind: 'fea_material' })}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
            selectedItem?.kind === 'fea_material'
              ? 'bg-[#253B5E] text-white'
              : 'text-[#D5DEE8] hover:bg-[#1E2531]'
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <ShieldCheck className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
            <span className="truncate">Materials: {mat.name}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectItem({ kind: 'fea_mesh' })}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
            selectedItem?.kind === 'fea_mesh'
              ? 'bg-[#253B5E] text-white'
              : 'text-[#D5DEE8] hover:bg-[#1E2531]'
          }`}
        >
          <span className="flex items-center gap-2 truncate">
            <Grid className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
            <span className="truncate">
              Mesh ({feaMesh ? `${feaMesh.elementCount} Tet` : feaSettings.meshResolution})
            </span>
          </span>
        </button>

        <div className="pt-1.5 mt-1 border-t border-[#232B38]">
          <div className="px-2 py-1 text-[11px] font-medium text-[#8B98AA]">
            Static Structural
          </div>
          {feaSettings.supports.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectItem({ kind: 'fea_support', supportId: s.id })}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-left transition-colors ${
                selectedItem?.kind === 'fea_support' && selectedItem.supportId === s.id
                  ? 'bg-[#1D3E32] text-[#A7F3D0]'
                  : 'text-[#C5D1DF] hover:bg-[#1E2531]'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Anchor className="w-3.5 h-3.5 text-[#34D399] shrink-0" />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="text-[10px] font-mono-tabular text-[#8B98AA]">
                {s.faceIds.length}y
              </span>
            </button>
          ))}

          {feaSettings.loads.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelectItem({ kind: 'fea_load', loadId: l.id })}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-left transition-colors ${
                selectedItem?.kind === 'fea_load' && selectedItem.loadId === l.id
                  ? 'bg-[#462529] text-[#FECACA]'
                  : 'text-[#C5D1DF] hover:bg-[#1E2531]'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <ArrowDownToLine className="w-3.5 h-3.5 text-[#F87171] shrink-0" />
                <span className="truncate">{l.name}</span>
              </span>
              <span className="text-[10px] font-mono-tabular text-[#FCA5A5]">
                {l.magnitude}{l.type === 'force' ? 'N' : 'MPa'}
              </span>
            </button>
          ))}
        </div>

        <div className="pt-1.5 mt-1 border-t border-[#232B38]">
          <div className="px-2 py-1 text-[11px] font-medium text-[#8B98AA]">
            Solution
          </div>
          {(
            [
              { mode: 'displacement', label: 'Total Deformation' },
              { mode: 'von_mises', label: 'Equivalent Stress (Von Mises)' },
              { mode: 'safety_factor', label: 'Safety Factor' },
            ] as const
          ).map((item) => (
            <button
              key={item.mode}
              type="button"
              onClick={() => {
                onSelectFeaResultMode(item.mode);
                onSelectItem({ kind: 'fea_solution', mode: item.mode });
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-left transition-colors ${
                feaSettings.resultMode === item.mode && feaResult
                  ? 'bg-[#253B5E] text-white'
                  : 'text-[#C5D1DF] hover:bg-[#1E2531]'
              }`}
            >
              <span className="truncate">{item.label}</span>
              {feaResult && (
                <span className="text-[10px] font-mono-tabular text-[#93C5FD]">
                  {item.mode === 'von_mises'
                    ? `${feaResult.maxVonMises.toFixed(1)}MPa`
                    : item.mode === 'displacement'
                    ? `${feaResult.maxDisplacement.toFixed(3)}mm`
                    : `${feaResult.minSafetyFactor.toFixed(2)}`}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const refItems = part.referenceGeometries ?? [];

  return (
    <div className="p-2.5 space-y-1 text-xs" data-testid="feature-manager-tree">
      <div className="px-2 py-1.5 text-[11px] font-semibold text-[#8EA0B5] flex items-center gap-1.5 border-b border-[#252D3B] mb-1.5">
        <FolderTree className="w-3.5 h-3.5 text-[#60A5FA]" />
        <span>FeatureManager ({part.name})</span>
      </div>

      {/* Origin & Standard Planes */}
      <button
        type="button"
        onClick={() => onSelectItem({ kind: 'origin' })}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${
          selectedItem?.kind === 'origin'
            ? 'bg-[#253B5E] text-white'
            : 'text-[#B8C4D4] hover:bg-[#1E2531]'
        }`}
      >
        <Compass className="w-3.5 h-3.5 text-[#FBBF24]" />
        <span>Origin (0, 0, 0)</span>
      </button>

      {(
        [
          { id: 'front', label: 'Front Plane (XY)' },
          { id: 'top', label: 'Top Plane (XZ)' },
          { id: 'right', label: 'Right Plane (YZ)' },
        ] as const
      ).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelectItem({ kind: 'plane', planeId: p.id })}
          className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${
            selectedItem?.kind === 'plane' && selectedItem.planeId === p.id
              ? 'bg-[#253B5E] text-white'
              : 'text-[#B8C4D4] hover:bg-[#1E2531]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>{p.label}</span>
        </button>
      ))}

      {/* Custom Reference Geometry */}
      {refItems.length > 0 && (
        <div className="pt-1.5 mt-1 border-t border-[#232B38]">
          <div className="px-2 py-0.5 text-[10px] font-medium text-[#7D8C9F]">
            Referans Geometrisi ({refItems.length})
          </div>
          {refItems.map((rf) => (
            <div
              key={rf.id}
              className={`flex items-center justify-between px-2 py-1 rounded ${
                selectedItem?.kind === 'ref' && selectedItem.refId === rf.id
                  ? 'bg-[#253B5E] text-white'
                  : 'text-[#D5DEE8] hover:bg-[#1E2531]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectItem({ kind: 'ref', refId: rf.id })}
                className="flex items-center gap-1.5 flex-1 text-left truncate"
              >
                {rf.kind === 'plane' && <Layers className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />}
                {rf.kind === 'axis' && <Axis3d className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />}
                {rf.kind === 'point' && <MapPin className="w-3.5 h-3.5 text-[#34D399] shrink-0" />}
                {rf.kind === 'coord_sys' && <Compass className="w-3.5 h-3.5 text-[#F87171] shrink-0" />}
                <span className="truncate">{rf.name}</span>
              </button>
              <button
                type="button"
                title={`Sil ${rf.name}`}
                aria-label={`Sil ${rf.name}`}
                onClick={() => onDeleteReferenceGeometry(rf.id)}
                className="p-1 rounded hover:bg-[#DC2626] text-[#9EB4CC] hover:text-white shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sketches */}
      <div className="pt-1.5 mt-1 border-t border-[#232B38]">
        <div className="px-2 py-0.5 text-[10px] font-medium text-[#7D8C9F]">
          Eskizler ({part.sketches.length})
        </div>
        {part.sketches.map((sk) => (
          <div
            key={sk.id}
            className={`group flex items-center justify-between px-2 py-1 rounded ${
              selectedItem?.kind === 'sketch' && selectedItem.sketchId === sk.id
                ? 'bg-[#253B5E] text-white'
                : 'text-[#D5DEE8] hover:bg-[#1E2531]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectItem({ kind: 'sketch', sketchId: sk.id })}
              className="flex items-center gap-1.5 flex-1 text-left truncate"
            >
              <PenTool className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
              <span className="truncate">{sk.name}</span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                title={`Düzenle ${sk.name}`}
                aria-label={`Düzenle ${sk.name}`}
                onClick={() => onEditSketch(sk)}
                className="p-1 rounded hover:bg-[#2F6FED] text-[#9EB4CC] hover:text-white"
              >
                <Edit3 className="w-3 h-3" />
              </button>
              <button
                type="button"
                title={`Sil ${sk.name}`}
                aria-label={`Sil ${sk.name}`}
                onClick={() => onDeleteSketch(sk.id)}
                className="p-1 rounded hover:bg-[#DC2626] text-[#9EB4CC] hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 3D Features */}
      <div className="pt-1.5 mt-1 border-t border-[#232B38]">
        <div className="px-2 py-0.5 text-[10px] font-medium text-[#7D8C9F]">
          3D Unsurlar ({part.features.length})
        </div>
        {part.features.map((feat: CadFeature) => (
          <div
            key={feat.id}
            className={`flex items-center justify-between px-2 py-1 rounded ${
              selectedItem?.kind === 'feature' && selectedItem.featureId === feat.id
                ? 'bg-[#253B5E] text-white'
                : feat.suppressed
                ? 'text-[#667385] hover:bg-[#1E2531]'
                : 'text-[#D5DEE8] hover:bg-[#1E2531]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectItem({ kind: 'feature', featureId: feat.id })}
              className="flex items-center gap-1.5 flex-1 text-left truncate"
            >
              <Box className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
              <span className={`truncate ${feat.suppressed ? 'line-through' : ''}`}>
                {feat.name}
              </span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                title={feat.suppressed ? `Aktifleştir ${feat.name}` : `Pasifleştir ${feat.name}`}
                aria-label={feat.suppressed ? `Aktifleştir ${feat.name}` : `Pasifleştir ${feat.name}`}
                onClick={() => onToggleFeatureSuppress(feat.id)}
                className="p-1 rounded hover:bg-[#2E394A] text-[#9EB4CC]"
              >
                {feat.suppressed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
              <button
                type="button"
                title={`Sil ${feat.name}`}
                aria-label={`Sil ${feat.name}`}
                onClick={() => onDeleteFeature(feat.id)}
                className="p-1 rounded hover:bg-[#DC2626] text-[#9EB4CC] hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Assembly Components & Mates */}
      {(activeTab === 'assembly' || components.length > 1 || mates.length > 0) && (
        <div className="pt-1.5 mt-1 border-t border-[#232B38]">
          <div className="px-2 py-0.5 text-[10px] font-medium text-[#7D8C9F]">
            Montaj Bileşenleri ({components.length}) &amp; Mate ({mates.length})
          </div>
          {components.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between px-2 py-1 rounded ${
                selectedItem?.kind === 'component' && selectedItem.componentId === c.id
                  ? 'bg-[#253B5E] text-white'
                  : 'text-[#D5DEE8] hover:bg-[#1E2531]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectItem({ kind: 'component', componentId: c.id })}
                className="flex-1 text-left truncate"
              >
                {c.fixed ? '(f) ' : '(-) '}
                {c.name}
              </button>
              {!c.fixed && (
                <button
                  type="button"
                  title={`Sil ${c.name}`}
                  aria-label={`Sil ${c.name}`}
                  onClick={() => onDeleteComponent(c.id)}
                  className="p-1 rounded hover:bg-[#DC2626] text-[#9EB4CC] hover:text-white"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {mates.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-3 py-1 rounded text-[#A8B4C4] hover:bg-[#1E2531]"
            >
              <button
                type="button"
                onClick={() => onSelectItem({ kind: 'mate', mateId: m.id })}
                className="flex-1 text-left truncate"
              >
                {m.name} ({m.type})
              </button>
              <button
                type="button"
                title={`Sil ${m.name}`}
                aria-label={`Sil ${m.name}`}
                onClick={() => onDeleteMate(m.id)}
                className="p-1 rounded hover:bg-[#DC2626] text-[#9EB4CC] hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
