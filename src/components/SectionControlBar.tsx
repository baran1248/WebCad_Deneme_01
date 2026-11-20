import React from 'react';
import { SectionAxis, SectionViewState } from '../types/cad';
import { FlipHorizontal2, Scissors, X } from 'lucide-react';

interface SectionControlBarProps {
  sectionView: SectionViewState;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  onChange: (next: SectionViewState) => void;
}

export const SectionControlBar: React.FC<SectionControlBarProps> = ({
  sectionView,
  boundsMin,
  boundsMax,
  onChange,
}) => {
  if (!sectionView.enabled) return null;

  const axisIdx = sectionView.axis === 'x' ? 0 : sectionView.axis === 'y' ? 1 : 2;
  const minVal = Math.floor(boundsMin[axisIdx] - 2);
  const maxVal = Math.ceil(boundsMax[axisIdx] + 2);
  const clampedOffset = Math.max(minVal, Math.min(maxVal, sectionView.offset));

  const handleAxisChange = (axis: SectionAxis) => {
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const mid = Math.round(((boundsMin[idx] + boundsMax[idx]) * 0.5) * 10) / 10;
    onChange({ ...sectionView, axis, offset: mid });
  };

  return (
    <div
      className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 bg-[#181E27]/95 border border-[#2C3545] rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-auto"
      role="region"
      aria-label="Section Plane Controls"
      data-testid="section-view-controls"
    >
      <div className="flex items-center gap-1 text-[11px] font-medium text-[#F59E0B] whitespace-nowrap">
        <Scissors className="w-3.5 h-3.5" />
        <span>Kesit Düzlemi:</span>
      </div>

      {/* Axis Selector */}
      <div className="flex items-center gap-0.5 bg-[#12161E] rounded p-0.5 border border-[#242C3A]">
        {(
          [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
            { id: 'z', label: 'Z' },
          ] as const
        ).map((ax) => {
          const active = sectionView.axis === ax.id;
          return (
            <button
              key={ax.id}
              type="button"
              aria-pressed={active}
              data-testid={`section-axis-${ax.id}`}
              onClick={() => handleAxisChange(ax.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                active
                  ? 'bg-[#D97706] text-white'
                  : 'text-[#B8C4D4] hover:text-white hover:bg-[#222A36]'
              }`}
            >
              {ax.label}
            </button>
          );
        })}
      </div>

      {/* Offset Slider */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={minVal}
          max={maxVal}
          step={0.5}
          value={clampedOffset}
          aria-label="Kesit Konumu"
          data-testid="section-offset-slider"
          onChange={(e) =>
            onChange({ ...sectionView, offset: Number(e.target.value) })
          }
          className="w-28 accent-[#F59E0B] cursor-pointer"
        />
        <span className="text-[11px] font-mono-tabular text-[#E6EDF3] w-14 text-right whitespace-nowrap">
          {clampedOffset.toFixed(1)} mm
        </span>
      </div>

      {/* Flip Cut Side */}
      <button
        type="button"
        aria-pressed={sectionView.flipped}
        data-testid="section-flip-button"
        title="Kesit Yönünü Ters Çevir"
        onClick={() =>
          onChange({ ...sectionView, flipped: !sectionView.flipped })
        }
        className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
          sectionView.flipped
            ? 'bg-[#D97706] text-white'
            : 'bg-[#222A36] text-[#C5D1DF] hover:text-white hover:bg-[#2C3646]'
        }`}
      >
        <FlipHorizontal2 className="w-3.5 h-3.5" />
        <span>Ters Çevir</span>
      </button>

      {/* Close Section View */}
      <button
        type="button"
        aria-label="Kesit Görünümünü Kapat"
        onClick={() => onChange({ ...sectionView, enabled: false })}
        className="p-1 rounded text-[#8B98AA] hover:text-white hover:bg-[#263040]"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
