import React from 'react';
import { SelectionFilter } from '../types/cad';
import { Square, Slash, CircleDot, Filter } from 'lucide-react';

interface SelectionFilterBarProps {
  value: SelectionFilter;
  onChange: (filter: SelectionFilter) => void;
}

export const SelectionFilterBar: React.FC<SelectionFilterBarProps> = ({
  value,
  onChange,
}) => {
  const options: Array<{
    id: SelectionFilter;
    label: string;
    title: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'face',
      label: 'Face',
      title: 'Yüzey Seçim Filtresi (Face)',
      icon: <Square className="w-3.5 h-3.5" />,
    },
    {
      id: 'edge',
      label: 'Edge',
      title: 'Kenar Seçim Filtresi (Edge)',
      icon: <Slash className="w-3.5 h-3.5" />,
    },
    {
      id: 'vertex',
      label: 'Vertex',
      title: 'Köşe Noktası Seçim Filtresi (Vertex)',
      icon: <CircleDot className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-[#181E27]/95 border border-[#2C3545] rounded-lg p-1 shadow-lg pointer-events-auto"
      role="group"
      aria-label="Selection Filter"
      data-testid="selection-filter-bar"
      data-active-filter={value}
    >
      <span className="flex items-center gap-1 px-2 text-[11px] font-medium text-[#9EB4CC] select-none whitespace-nowrap">
        <Filter className="w-3 h-3 text-[#60A5FA]" />
        <span>Seçim Filtresi:</span>
      </span>
      <div className="flex items-center gap-0.5 bg-[#12161E] rounded p-0.5 border border-[#242C3A]">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              title={opt.title}
              data-testid={`selection-filter-${opt.id}`}
              onClick={() => onChange(opt.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#2F6FED] text-white shadow-sm'
                  : 'text-[#B8C4D4] hover:text-white hover:bg-[#222A36]'
              }`}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
