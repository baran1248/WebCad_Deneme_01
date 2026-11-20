import React from 'react';
import { FeaResult } from '../types/cad';

interface FeaColorbarProps {
  result: FeaResult;
  mode: 'von_mises' | 'displacement' | 'safety_factor';
}

export const FeaColorbar: React.FC<FeaColorbarProps> = ({ result, mode }) => {
  let minVal = 0;
  let maxVal = 1;
  let unit = 'MPa';
  let title = 'Von Mises Gerilmesi';

  if (mode === 'von_mises') {
    minVal = result.minVonMises;
    maxVal = Math.max(result.maxVonMises, minVal + 1e-4);
    unit = 'MPa';
    title = 'Eşdeğer Gerilme (Von Mises)';
  } else if (mode === 'displacement') {
    minVal = 0;
    maxVal = Math.max(result.maxDisplacement, 1e-5);
    unit = 'mm';
    title = 'Toplam Yer Değiştirme';
  } else {
    minVal = result.minSafetyFactor;
    maxVal = 15;
    unit = 'SF';
    title = 'Emniyet Katsayısı';
  }

  const ticks = [1, 0.75, 0.5, 0.25, 0].map((t) => {
    const val = minVal + (maxVal - minVal) * t;
    return val >= 100
      ? val.toFixed(1)
      : val >= 1
      ? val.toFixed(2)
      : val.toFixed(4);
  });

  // For safety factor, red is low SF, blue is high SF; for stress/disp, red is high, blue is low
  const gradient =
    mode === 'safety_factor'
      ? 'linear-gradient(to bottom, #00008f 0%, #0066ff 25%, #00ff99 50%, #ffcc00 75%, #cc0000 100%)'
      : 'linear-gradient(to bottom, #cc0000 0%, #ff8800 25%, #22ee66 50%, #0088ff 75%, #00008f 100%)';

  return (
    <div
      className="absolute right-3 bottom-12 z-10 bg-[#161B23]/95 border border-[#2C3545] rounded-lg p-3 shadow-lg w-[164px] pointer-events-auto"
      data-testid="fea-colorbar"
    >
      <div className="text-[11px] font-semibold text-[#E6EDF3] leading-tight mb-1">
        {title}
      </div>
      <div className="text-[10px] text-[#8B98AA] mb-2 font-mono-tabular">
        Birim: {unit}
      </div>

      <div className="flex items-stretch gap-2.5 h-[180px]">
        <div
          className="w-4 rounded-sm border border-[#344052] shrink-0"
          style={{ background: gradient }}
        />
        <div className="flex flex-col justify-between text-[11px] font-mono-tabular text-[#D5DEE8] py-0.5">
          {ticks.map((tick, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="w-1.5 h-px bg-[#5C6B80]" />
              <span>{tick}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-[#26303F] space-y-1 text-[10px] font-mono-tabular">
        <div className="flex justify-between text-[#9AA8BA]">
          <span>Maks:</span>
          <span className="text-[#F0F6FC] font-medium">
            {mode === 'displacement'
              ? `${result.maxDisplacement.toFixed(4)} mm`
              : mode === 'von_mises'
              ? `${result.maxVonMises.toFixed(2)} MPa`
              : `${result.minSafetyFactor.toFixed(2)} (Min)`}
          </span>
        </div>
        <div className="flex justify-between text-[#9AA8BA]">
          <span>Eleman:</span>
          <span className="text-[#D5DEE8]">{result.elementCount} Tet</span>
        </div>
        <div className="flex justify-between text-[#9AA8BA]">
          <span>Çözüm:</span>
          <span className="text-[#D5DEE8]">{result.solveTimeMs} ms</span>
        </div>
      </div>
    </div>
  );
};
