import React from 'react';
import { Maximize2, Eye, Box } from 'lucide-react';

export type CameraPreset = 'front' | 'top' | 'right' | 'iso' | 'fit';

interface ViewCubeProps {
  onSelectView: (preset: CameraPreset) => void;
  displayMode: 'shaded_edges' | 'shaded' | 'wireframe';
  onChangeDisplayMode: (mode: 'shaded_edges' | 'shaded' | 'wireframe') => void;
}

export const ViewCube: React.FC<ViewCubeProps> = ({
  onSelectView,
  displayMode,
  onChangeDisplayMode,
}) => {
  return (
    <div
      className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2 pointer-events-auto"
      data-testid="viewcube-controls"
    >
      {/* Interactive 3D-style Orientation Cube Pad */}
      <div className="bg-[#181E27]/95 border border-[#2C3545] rounded-lg p-2 shadow-lg">
        <div className="grid grid-cols-3 gap-1 w-[114px]">
          <div />
          <button
            type="button"
            onClick={() => onSelectView('top')}
            title="Üst Görünüm (Top)"
            className="h-7 rounded text-[11px] font-medium bg-[#222A36] hover:bg-[#2F6FED] text-[#D8E1EC] hover:text-white transition-colors whitespace-nowrap"
          >
            Üst
          </button>
          <button
            type="button"
            onClick={() => onSelectView('iso')}
            title="İzometrik Görünüm"
            className="h-7 rounded text-[11px] font-medium bg-[#222A36] hover:bg-[#2F6FED] text-[#9EB4CC] hover:text-white transition-colors whitespace-nowrap"
          >
            İzo
          </button>
          <button
            type="button"
            onClick={() => onSelectView('front')}
            title="Ön Görünüm (Front)"
            className="col-span-2 h-8 rounded text-[11px] font-semibold bg-[#253042] hover:bg-[#2F6FED] text-[#E6EDF3] hover:text-white border border-[#364359] transition-colors whitespace-nowrap"
          >
            Ön (XY)
          </button>
          <button
            type="button"
            onClick={() => onSelectView('right')}
            title="Sağ Görünüm (Right)"
            className="h-8 rounded text-[11px] font-medium bg-[#222A36] hover:bg-[#2F6FED] text-[#D8E1EC] hover:text-white transition-colors whitespace-nowrap"
          >
            Sağ
          </button>
        </div>

        <div className="mt-1.5 pt-1.5 border-t border-[#283140] flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => onSelectView('fit')}
            title="Ekrana Sığdır (Fit to View)"
            className="flex-1 flex items-center justify-center gap-1 h-6 rounded text-[11px] bg-[#202733] hover:bg-[#2B3647] text-[#C5D1DF] transition-colors whitespace-nowrap"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Sığdır</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onChangeDisplayMode(
                displayMode === 'shaded_edges'
                  ? 'shaded'
                  : displayMode === 'shaded'
                  ? 'wireframe'
                  : 'shaded_edges'
              )
            }
            title="Görünüm Modunu Değiştir"
            className="flex items-center justify-center gap-1 px-2 h-6 rounded text-[11px] bg-[#202733] hover:bg-[#2B3647] text-[#C5D1DF] transition-colors whitespace-nowrap"
          >
            {displayMode === 'wireframe' ? (
              <Box className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            <span>
              {displayMode === 'shaded_edges'
                ? 'Kenarlı'
                : displayMode === 'shaded'
                ? 'Katı'
                : 'Kafes'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
