'use client';

import { GitBranch, Layers, Package, AlertTriangle } from 'lucide-react';
import type { BomMapping } from '@/types';

interface BomStatsBarProps {
  mappings: BomMapping[];
  showMissingOnly: boolean;
  onToggleMissing: () => void;
}

export function BomStatsBar({ mappings, showMissingOnly, onToggleMissing }: BomStatsBarProps) {
  const wipCount = new Set(mappings.map(m => m.wip_code)).size;
  const totalEntries = mappings.length;
  const uniqueComponents = new Set(mappings.map(m => m.component_code)).size;
  const missingCount = mappings.filter(m => m.missing_from_inventory).length;
  const missingWips = new Set(mappings.filter(m => m.missing_from_inventory).map(m => m.wip_code)).size;

  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="stat-card stat-card-blue">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>WIP Codes</span>
          <GitBranch size={15} className="text-[var(--muted-light)]" />
        </div>
        <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{wipCount}</div>
        <div className="text-[10px] text-[var(--muted)] mt-0.5">mapped products</div>
      </div>

      <div className="stat-card stat-card-green">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>BOM Entries</span>
          <Layers size={15} className="text-[var(--muted-light)]" />
        </div>
        <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{totalEntries.toLocaleString()}</div>
        <div className="text-[10px] text-[var(--muted)] mt-0.5">total mappings</div>
      </div>

      <div className="stat-card stat-card-amber">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>Unique Parts</span>
          <Package size={15} className="text-[var(--muted-light)]" />
        </div>
        <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{uniqueComponents}</div>
        <div className="text-[10px] text-[var(--muted)] mt-0.5">distinct components</div>
      </div>

      <div
        className={`stat-card ${missingCount > 0 ? 'stat-card-red card-interactive' : 'stat-card-green'}`}
        onClick={missingCount > 0 ? onToggleMissing : undefined}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>Missing</span>
          <AlertTriangle size={15} className={missingCount > 0 ? 'text-[var(--error)]' : 'text-[var(--muted-light)]'} />
        </div>
        <div className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: missingCount > 0 ? 'var(--error)' : 'var(--success)' }}>
          {missingCount}
        </div>
        <div className="text-[10px] text-[var(--muted)] mt-0.5">
          {missingCount > 0
            ? `in ${missingWips} WIP${missingWips !== 1 ? 's' : ''} · ${showMissingOnly ? 'click to clear' : 'click to filter'}`
            : 'all components found'}
        </div>
      </div>
    </div>
  );
}
