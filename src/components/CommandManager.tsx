import React, { useRef, useState } from 'react';
import {
  CommandTab,
  EvaluateVisualMode,
  FeatureType,
  FeaSettings,
  MateType,
  ReferenceGeometryItem,
  SketchRelationType,
  SketchTool,
} from '../types/cad';
import {
  PenTool,
  Box,
  Layers,
  Ruler,
  Activity,
  Minus,
  Square,
  Circle,
  Spline,
  ArrowLeftRight,
  ArrowUpDown,
  Link2,
  Move3d,
  Scissors,
  RotateCw,
  SplinePointer,
  Triangle,
  Plus,
  Anchor,
  ArrowDownToLine,
  Play,
  Grid,
  Download,
  Upload,
  RotateCcw,
  FilePlus2,
  Save,
  ChevronDown,
  Check,
  X,
  Compass,
  Hexagon,
  Equal,
  FlipHorizontal2,
  Copy,
  Crosshair,
  ShieldCheck,
  Table2,
  Expand,
  AlertTriangle,
  Sparkles,
  Scale,
  Axis3d,
  MapPin,
  BoxSelect,
} from 'lucide-react';

export type SketchModifyAction =
  | 'offset'
  | 'mirror'
  | 'linear_pattern'
  | 'circular_pattern'
  | 'convert_entities';

export type AssemblyToolPanel = 'move' | 'explode' | 'interference' | 'bom';
export type EvaluateToolPanel = 'measure' | 'mass' | 'check_geometry';

interface CommandManagerProps {
  activeTab: CommandTab;
  onSelectTab: (tab: CommandTab) => void;
  isSketchActive: boolean;
  sketchTool: SketchTool;
  onSetSketchTool: (t: SketchTool) => void;
  onStartNewSketch: () => void;
  onExitSketch: (save: boolean) => void;
  onApplySketchConstraint: (type: SketchRelationType) => void;
  onSketchModify: (action: SketchModifyAction) => void;
  onStartFeature: (type: FeatureType) => void;
  onAddReferenceGeometry: (kind: ReferenceGeometryItem['kind']) => void;
  onAddAssemblyPart: (partId: string) => void;
  onStartAssemblyMate: (type: MateType) => void;
  onOpenAssemblyTool: (panel: AssemblyToolPanel) => void;
  onAssemblyPattern: () => void;
  onAssemblyMirror: () => void;
  explodeFactor: number;
  onOpenEvaluateTool: (panel: EvaluateToolPanel) => void;
  evaluateMode: EvaluateVisualMode;
  onToggleEvaluateMode: (mode: Exclude<EvaluateVisualMode, 'none'>) => void;
  feaSettings: FeaSettings;
  onUpdateFeaMode: (mode: FeaSettings['resultMode']) => void;
  onGenerateFeaMesh: () => void;
  onStartAddSupport: () => void;
  onStartAddLoad: () => void;
  onRunFeaSolve: () => void;
  isSolvingFea: boolean;
  onExportFile: (fmt: 'step' | 'iges' | 'stl' | 'obj' | 'mcad') => void;
  onImportFile: (file: File) => void;
  onResetProject: () => void;
  onSaveNow: () => void;
  sectionViewEnabled: boolean;
  onToggleSectionView: () => void;
  availableParts: Array<{ id: string; name: string }>;
}

export const CommandManager: React.FC<CommandManagerProps> = ({
  activeTab,
  onSelectTab,
  isSketchActive,
  sketchTool,
  onSetSketchTool,
  onStartNewSketch,
  onExitSketch,
  onApplySketchConstraint,
  onSketchModify,
  onStartFeature,
  onAddReferenceGeometry,
  onAddAssemblyPart,
  onStartAssemblyMate,
  onOpenAssemblyTool,
  onAssemblyPattern,
  onAssemblyMirror,
  explodeFactor,
  onOpenEvaluateTool,
  evaluateMode,
  onToggleEvaluateMode,
  feaSettings,
  onUpdateFeaMode,
  onGenerateFeaMesh,
  onStartAddSupport,
  onStartAddLoad,
  onRunFeaSolve,
  isSolvingFea,
  onExportFile,
  onImportFile,
  onResetProject,
  onSaveNow,
  sectionViewEnabled,
  onToggleSectionView,
  availableParts,
}) => {
  const [menuOpen, setMenuOpen] = useState<'export' | 'part' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: Array<{ id: CommandTab; label: string; icon: React.ReactNode }> = [
    { id: 'sketch', label: 'Sketch', icon: <PenTool className="w-3.5 h-3.5" /> },
    { id: 'features', label: 'Features', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'reference', label: 'Referans', icon: <Compass className="w-3.5 h-3.5" /> },
    { id: 'assembly', label: 'Assembly', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'evaluate', label: 'Evaluate', icon: <Ruler className="w-3.5 h-3.5" /> },
    { id: 'fea', label: 'FEA (Ansys)', icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      onImportFile(f);
      e.target.value = '';
    }
  };

  const featureBtnClass =
    'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3] hover:text-white border border-[#344054] whitespace-nowrap shrink-0 transition-colors';

  return (
    <header className="bg-[#181D26] border-b border-[#2A3241] shrink-0 z-20">
      {/* Row 1: Brand + CommandManager Tabs + File I/O */}
      <div className="h-10 px-3 flex items-center justify-between gap-3 border-b border-[#242C3A]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded bg-[#2F6FED] flex items-center justify-center text-white font-bold text-xs">
              W
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#F0F6FC] whitespace-nowrap">
              WebCad_Deneme1
            </span>
          </div>

          <div className="h-4 w-px bg-[#2D3646]" />

          <nav
            className="flex items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label="CommandManager"
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#2F6FED] text-white'
                      : 'text-[#A8B4C4] hover:text-white hover:bg-[#232A36]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 relative">
          <button
            type="button"
            aria-pressed={sectionViewEnabled}
            data-testid="command-section-view-toggle"
            onClick={onToggleSectionView}
            title="Kesit Görünümü (Section View)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap border ${
              sectionViewEnabled
                ? 'bg-[#D97706] border-[#F59E0B] text-white'
                : 'bg-[#212834] border-[#303A4D] text-[#D5DEE8] hover:text-white hover:bg-[#2A3343]'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Section View</span>
          </button>

          <div className="h-4 w-px bg-[#2D3646] mx-0.5" />

          <input
            ref={fileInputRef}
            type="file"
            accept=".step,.stp,.iges,.igs,.stl,.obj,.json,.mcad.json"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={onResetProject}
            title="Varsayılan Delikli Braket Projesini Yükle"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#C5D1DF] hover:text-white hover:bg-[#252D3B] transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Varsayılan</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#C5D1DF] hover:text-white hover:bg-[#252D3B] transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>İçe Aktar</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(menuOpen === 'export' ? null : 'export')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#232B38] hover:bg-[#2D3849] text-[#E6EDF3] border border-[#344054] transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Dışa Aktar</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {menuOpen === 'export' && (
              <div className="absolute right-0 mt-1 w-52 bg-[#1B222D] border border-[#323C4E] rounded-md shadow-xl py-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    onExportFile('step');
                    setMenuOpen(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#E6EDF3] hover:bg-[#2F6FED] hover:text-white"
                >
                  .STEP (AP214 SolidWorks/Ansys)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportFile('iges');
                    setMenuOpen(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#E6EDF3] hover:bg-[#2F6FED] hover:text-white"
                >
                  .IGES (IGES 5.3 ASCII)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportFile('stl');
                    setMenuOpen(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#E6EDF3] hover:bg-[#2F6FED] hover:text-white"
                >
                  .STL (3D Baskı / Mesh)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportFile('obj');
                    setMenuOpen(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#E6EDF3] hover:bg-[#2F6FED] hover:text-white"
                >
                  .OBJ (Wavefront)
                </button>
                <div className="my-1 border-t border-[#2A3342]" />
                <button
                  type="button"
                  onClick={() => {
                    onExportFile('mcad');
                    setMenuOpen(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#93C5FD] hover:bg-[#2F6FED] hover:text-white"
                >
                  .mcad.json (Parametrik Proje)
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onSaveNow}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[#1F4E3D] hover:bg-[#25634D] text-[#D1FAE5] transition-colors whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Kaydet</span>
          </button>
        </div>
      </div>

      {/* Row 2: Contextual SolidWorks Ribbon Toolbar */}
      <div className="min-h-10 py-1.5 px-3 flex flex-wrap items-center gap-1 bg-[#1D232E]">
        {activeTab === 'sketch' && (
          <>
            {!isSketchActive ? (
              <button
                type="button"
                onClick={onStartNewSketch}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[#2F6FED] hover:bg-[#255CE0] text-white whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Yeni Eskiz</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onExitSketch(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#1E7E50] hover:bg-[#196943] text-white whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Onayla</span>
                </button>
                <button
                  type="button"
                  onClick={() => onExitSketch(false)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#D5DEE8] hover:bg-[#2B3444] whitespace-nowrap shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>İptal</span>
                </button>
              </>
            )}

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            {(
              [
                { id: 'select', label: 'Seç', icon: <SplinePointer className="w-3.5 h-3.5" /> },
                { id: 'line', label: 'Line', icon: <Minus className="w-3.5 h-3.5" /> },
                { id: 'centerline', label: 'Centerline', icon: <Minus className="w-3.5 h-3.5 opacity-60" /> },
                { id: 'rect', label: 'Rect', icon: <Square className="w-3.5 h-3.5" /> },
                { id: 'circle', label: 'Circle', icon: <Circle className="w-3.5 h-3.5" /> },
                { id: 'arc', label: 'Arc', icon: <Spline className="w-3.5 h-3.5" /> },
                { id: 'polygon', label: 'Polygon', icon: <Hexagon className="w-3.5 h-3.5" /> },
                { id: 'slot', label: 'Slot', icon: <BoxSelect className="w-3.5 h-3.5" /> },
                { id: 'spline', label: 'Spline', icon: <Sparkles className="w-3.5 h-3.5" /> },
                { id: 'dimension', label: 'Smart Dim', icon: <Ruler className="w-3.5 h-3.5" /> },
                { id: 'trim', label: 'Trim', icon: <Scissors className="w-3.5 h-3.5" /> },
              ] as const
            ).map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  if (!isSketchActive && tool.id !== 'select') onStartNewSketch();
                  onSetSketchTool(tool.id);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  sketchTool === tool.id && isSketchActive
                    ? 'bg-[#2F6FED] text-white'
                    : 'text-[#C5D1DF] hover:bg-[#273040] hover:text-white'
                }`}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </button>
            ))}

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            {(
              [
                { id: 'offset', label: 'Offset', icon: <Copy className="w-3 h-3" /> },
                { id: 'mirror', label: 'Mirror', icon: <FlipHorizontal2 className="w-3 h-3" /> },
                { id: 'linear_pattern', label: 'Lin Pat', icon: <Grid className="w-3 h-3" /> },
                { id: 'circular_pattern', label: 'Circ Pat', icon: <RotateCw className="w-3 h-3" /> },
                { id: 'convert_entities', label: 'Convert', icon: <ArrowDownToLine className="w-3 h-3" /> },
              ] as const
            ).map((mod) => (
              <button
                key={mod.id}
                type="button"
                onClick={() => onSketchModify(mod.id)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#B8D0EB] hover:bg-[#273040] hover:text-white whitespace-nowrap shrink-0"
              >
                {mod.icon}
                <span>{mod.label}</span>
              </button>
            ))}

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            {(
              [
                { id: 'horizontal', label: 'Horiz', icon: <ArrowLeftRight className="w-3 h-3" /> },
                { id: 'vertical', label: 'Vert', icon: <ArrowUpDown className="w-3 h-3" /> },
                { id: 'coincident', label: 'Coinc', icon: <Link2 className="w-3 h-3" /> },
                { id: 'parallel', label: 'Parallel', icon: <Minus className="w-3 h-3" /> },
                { id: 'perpendicular', label: 'Perp', icon: <Plus className="w-3 h-3" /> },
                { id: 'tangent', label: 'Tangent', icon: <Circle className="w-3 h-3" /> },
                { id: 'equal', label: 'Equal', icon: <Equal className="w-3 h-3" /> },
              ] as const
            ).map((rel) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => onApplySketchConstraint(rel.id)}
                className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-[#C5D1DF] hover:bg-[#273040] hover:text-white whitespace-nowrap shrink-0"
              >
                {rel.icon}
                <span>{rel.label}</span>
              </button>
            ))}
          </>
        )}

        {activeTab === 'features' && (
          <>
            <button type="button" onClick={() => onStartFeature('extrude_boss')} className={featureBtnClass}>
              <Move3d className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Extrude Boss</span>
            </button>
            <button type="button" onClick={() => onStartFeature('revolve')} className={featureBtnClass}>
              <RotateCw className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Revolve</span>
            </button>
            <button type="button" onClick={() => onStartFeature('swept_boss')} className={featureBtnClass}>
              <Spline className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Swept Boss</span>
            </button>
            <button type="button" onClick={() => onStartFeature('loft_boss')} className={featureBtnClass}>
              <Layers className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Loft Boss</span>
            </button>

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            <button type="button" onClick={() => onStartFeature('extrude_cut')} className={featureBtnClass}>
              <Scissors className="w-3.5 h-3.5 text-[#F87171]" />
              <span>Extrude Cut</span>
            </button>
            <button type="button" onClick={() => onStartFeature('revolve_cut')} className={featureBtnClass}>
              <RotateCcw className="w-3.5 h-3.5 text-[#F87171]" />
              <span>Revolve Cut</span>
            </button>
            <button type="button" onClick={() => onStartFeature('swept_cut')} className={featureBtnClass}>
              <Spline className="w-3.5 h-3.5 text-[#F87171]" />
              <span>Swept Cut</span>
            </button>
            <button type="button" onClick={() => onStartFeature('hole_wizard')} className={featureBtnClass}>
              <Crosshair className="w-3.5 h-3.5 text-[#FBBF24]" />
              <span>Hole Wizard</span>
            </button>

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            <button type="button" onClick={() => onStartFeature('fillet')} className={featureBtnClass}>
              <Circle className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Fillet</span>
            </button>
            <button type="button" onClick={() => onStartFeature('chamfer')} className={featureBtnClass}>
              <Triangle className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Chamfer</span>
            </button>
            <button type="button" onClick={() => onStartFeature('shell')} className={featureBtnClass}>
              <Box className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Shell (Kabuk)</span>
            </button>
            <button type="button" onClick={() => onStartFeature('draft')} className={featureBtnClass}>
              <Triangle className="w-3.5 h-3.5 text-[#FBBF24]" />
              <span>Draft</span>
            </button>
            <button type="button" onClick={() => onStartFeature('rib')} className={featureBtnClass}>
              <Minus className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Rib (Feder)</span>
            </button>

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            <button type="button" onClick={() => onStartFeature('linear_pattern')} className={featureBtnClass}>
              <Grid className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Linear Pattern</span>
            </button>
            <button type="button" onClick={() => onStartFeature('circular_pattern')} className={featureBtnClass}>
              <RotateCw className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Circular Pattern</span>
            </button>
            <button type="button" onClick={() => onStartFeature('mirror')} className={featureBtnClass}>
              <FlipHorizontal2 className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Mirror</span>
            </button>
            <button type="button" onClick={() => onStartFeature('combine')} className={featureBtnClass}>
              <Plus className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Combine</span>
            </button>
          </>
        )}

        {activeTab === 'reference' && (
          <>
            <button
              type="button"
              onClick={() => onAddReferenceGeometry('plane')}
              className={featureBtnClass}
            >
              <Layers className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Referans Düzlem (Plane)</span>
            </button>
            <button
              type="button"
              onClick={() => onAddReferenceGeometry('axis')}
              className={featureBtnClass}
            >
              <Axis3d className="w-3.5 h-3.5 text-[#FBBF24]" />
              <span>Referans Eksen (Axis)</span>
            </button>
            <button
              type="button"
              onClick={() => onAddReferenceGeometry('point')}
              className={featureBtnClass}
            >
              <MapPin className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Referans Nokta (Point)</span>
            </button>
            <button
              type="button"
              onClick={() => onAddReferenceGeometry('coord_sys')}
              className={featureBtnClass}
            >
              <Compass className="w-3.5 h-3.5 text-[#F87171]" />
              <span>Koordinat Sistemi (CSYS)</span>
            </button>
          </>
        )}

        {activeTab === 'assembly' && (
          <>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(menuOpen === 'part' ? null : 'part')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[#2F6FED] hover:bg-[#255CE0] text-white whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Parça Ekle</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {menuOpen === 'part' && (
                <div className="fixed mt-1 w-48 bg-[#1B222D] border border-[#323C4E] rounded-md shadow-xl py-1 z-50">
                  {availableParts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onAddAssemblyPart(p.id);
                        setMenuOpen(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-[#E6EDF3] hover:bg-[#2F6FED] hover:text-white"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            {(
              [
                { id: 'coincident', label: 'Coincident' },
                { id: 'concentric', label: 'Concentric' },
                { id: 'distance', label: 'Distance' },
                { id: 'parallel', label: 'Parallel' },
                { id: 'perpendicular', label: 'Perp' },
                { id: 'angle', label: 'Angle' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onStartAssemblyMate(m.id)}
                className={featureBtnClass}
              >
                <Link2 className="w-3 h-3 text-[#60A5FA]" />
                <span>Mate: {m.label}</span>
              </button>
            ))}

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            <button
              type="button"
              onClick={() => onOpenAssemblyTool('move')}
              className={featureBtnClass}
            >
              <Move3d className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Taşı/Döndür</span>
            </button>
            <button type="button" onClick={onAssemblyPattern} className={featureBtnClass}>
              <Grid className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Bileşen Çoğalt</span>
            </button>
            <button type="button" onClick={onAssemblyMirror} className={featureBtnClass}>
              <FlipHorizontal2 className="w-3.5 h-3.5 text-[#A78BFA]" />
              <span>Aynala</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenAssemblyTool('explode')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 ${
                explodeFactor > 0
                  ? 'bg-[#D97706] border-[#F59E0B] text-white'
                  : 'bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3] border-[#344054]'
              }`}
            >
              <Expand className="w-3.5 h-3.5" />
              <span>Patlatılmış (Explode)</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenAssemblyTool('interference')}
              className={featureBtnClass}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#FBBF24]" />
              <span>Çakışma Analizi</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenAssemblyTool('bom')}
              className={featureBtnClass}
            >
              <Table2 className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>BOM Listesi</span>
            </button>
          </>
        )}

        {activeTab === 'evaluate' && (
          <>
            <button
              type="button"
              onClick={() => onOpenEvaluateTool('measure')}
              className={featureBtnClass}
            >
              <Ruler className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span>Ölçüm (Measure)</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenEvaluateTool('mass')}
              className={featureBtnClass}
            >
              <Scale className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Kütle &amp; Atalet (Mass Prop)</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenEvaluateTool('check_geometry')}
              className={featureBtnClass}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>Geometri Kontrol (Check)</span>
            </button>

            <div className="h-5 w-px bg-[#2D3646] mx-0.5 shrink-0" />

            <button
              type="button"
              aria-pressed={evaluateMode === 'draft_analysis'}
              onClick={() => onToggleEvaluateMode('draft_analysis')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 ${
                evaluateMode === 'draft_analysis'
                  ? 'bg-[#1E7E50] border-[#34D399] text-white'
                  : 'bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3] border-[#344054]'
              }`}
            >
              <Triangle className="w-3.5 h-3.5" />
              <span>Draft Analizi</span>
            </button>
            <button
              type="button"
              aria-pressed={evaluateMode === 'curvature'}
              onClick={() => onToggleEvaluateMode('curvature')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 ${
                evaluateMode === 'curvature'
                  ? 'bg-[#9333EA] border-[#C084FC] text-white'
                  : 'bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3] border-[#344054]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Eğrilik (Curvature)</span>
            </button>
          </>
        )}

        {activeTab === 'fea' && (
          <>
            <button
              type="button"
              onClick={onGenerateFeaMesh}
              className={featureBtnClass}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Mesh Oluştur</span>
            </button>
            <button
              type="button"
              onClick={onStartAddSupport}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[#253042] hover:bg-[#1E7E50] text-[#E6EDF3] border border-[#344054] whitespace-nowrap shrink-0"
            >
              <Anchor className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Fixed Support (Sabit Mesnet)</span>
            </button>
            <button
              type="button"
              onClick={onStartAddLoad}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-[#253042] hover:bg-[#C2410C] text-[#E6EDF3] border border-[#344054] whitespace-nowrap shrink-0"
            >
              <ArrowDownToLine className="w-3.5 h-3.5 text-[#F87171]" />
              <span>Force / Pressure (Yük)</span>
            </button>
            <button
              type="button"
              onClick={onRunFeaSolve}
              disabled={isSolvingFea}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded text-xs font-semibold bg-[#2F6FED] hover:bg-[#255CE0] disabled:opacity-50 text-white whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isSolvingFea ? 'Çözülüyor...' : 'Solve (Çözümü Başlat)'}</span>
            </button>

            <div className="h-5 w-px bg-[#2D3646] mx-1" />

            <div className="flex items-center gap-1 bg-[#141922] p-0.5 rounded border border-[#2A3342]">
              {(
                [
                  { id: 'von_mises', label: 'Von Mises (MPa)' },
                  { id: 'displacement', label: 'Deformasyon (mm)' },
                  { id: 'safety_factor', label: 'Emniyet Katsayısı' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdateFeaMode(m.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    feaSettings.resultMode === m.id
                      ? 'bg-[#2F6FED] text-white'
                      : 'text-[#9FB0C4] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </header>
  );
};
