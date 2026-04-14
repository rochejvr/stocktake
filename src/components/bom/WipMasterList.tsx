'use client';

import { useMemo } from 'react';
import { Search, GitBranch, AlertTriangle, X } from 'lucide-react';
import type { BomMapping } from '@/types';

interface WipMasterListProps {
  mappings: BomMapping[];
  search: string;
  onSearchChange: (v: string) => void;
  selectedWip: string | null;
  onSelectWip: (wip: string) => void;
  showMissingOnly: boolean;
  onClearMissing: () => void;
}

export function WipMasterList({
  mappings, search, onSearchChange, selectedWip, onSelectWip,
  showMissingOnly, onClearMissing,
}: WipMasterListProps) {
  const grouped = useMemo(() => {
    const map: Record<string, BomMapping[]> = {};
    for (const m of mappings) {
      if (!map[m.wip_code]) map[m.wip_code] = [];
      map[m.wip_code].push(m);
    }
    return map;
  }, [mappings]);

  const searchTerm = search.trim().toLowerCase();

  const filteredWips = useMemo(() =>
    Object.keys(grouped).filter(wip => {
      if (showMissingOnly && !grouped[wip].some(m => m.missing_from_inventory)) return false;
      if (!searchTerm) return true;
      return (
        wip.toLowerCase().includes(searchTerm) ||
        grouped[wip].some(m =>
          m.component_code.toLowerCase().includes(searchTerm) ||
          (m.component_description || '').toLowerCase().includes(searchTerm)
        )
      );
    }).sort(),
    [grouped, searchTerm, showMissingOnly]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
          <input
            className="input text-xs"
            style={{ paddingLeft: '2rem' }}
            placeholder="Search WIP or component..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        {showMissingOnly && (
          <button
            onClick={onClearMissing}
            className="flex items-center gap-1 mt-2 px-2 py-1 rounded text-[10px] font-medium border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors w-full justify-center"
          >
            <AlertTriangle size={10} /> Missing only <X size={10} />
          </button>
        )}
      </div>

      {/* Count */}
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] border-b"
        style={{ borderColor: 'var(--card-border-light)', fontFamily: 'var(--font-display)' }}>
        {filteredWips.length} WIP{filteredWips.length !== 1 ? 's' : ''}
        {searchTerm && ` matching "${search}"`}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredWips.map(wip => {
          const components = grouped[wip];
          const hasMissing = components.some(c => c.missing_from_inventory);
          const missingN = components.filter(c => c.missing_from_inventory).length;
          const active = selectedWip === wip;

          return (
            <button
              key={wip}
              onClick={() => onSelectWip(wip)}
              className="w-full text-left px-3 py-2.5 border-b flex items-center gap-2 transition-all hover:bg-blue-50/50"
              style={{
                borderColor: 'var(--card-border-light)',
                background: active ? 'var(--primary-light)' : hasMissing ? '#fffbeb' : 'transparent',
                borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs font-semibold truncate" style={{ color: active ? 'var(--primary)' : 'var(--foreground)' }}>
                  {wip}
                </div>
              </div>
              <span className="badge badge-slate text-[9px]">{components.length}</span>
              {hasMissing && (
                <span className="badge badge-amber text-[9px]">{missingN}</span>
              )}
            </button>
          );
        })}

        {filteredWips.length === 0 && (
          <div className="p-6 text-center text-xs text-[var(--muted)]">
            No WIPs found
          </div>
        )}
      </div>
    </div>
  );
}
