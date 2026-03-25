'use client';

import { useMemo } from 'react';
import { X, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { ComponentSearch } from '@/components/shared/ComponentSearch';
import type { BomMapping } from '@/types';

interface ComponentCompareProps {
  mappings: BomMapping[];
  codeA: string;
  codeB: string;
  onCodeAChange: (v: string) => void;
  onCodeBChange: (v: string) => void;
  onClose: () => void;
  onSelectWip: (wip: string) => void;
}

interface CompareRow {
  wipCode: string;
  qtyA: number | null;
  qtyB: number | null;
  status: 'match' | 'qty_mismatch' | 'a_missing' | 'b_missing';
}

export function ComponentCompare({ mappings, codeA, codeB, onCodeAChange, onCodeBChange, onClose, onSelectWip }: ComponentCompareProps) {
  const results = useMemo<CompareRow[]>(() => {
    if (!codeA || !codeB) return [];
    const a = codeA.toUpperCase();
    const b = codeB.toUpperCase();

    const map = new Map<string, { qtyA: number | null; qtyB: number | null }>();
    for (const m of mappings) {
      const code = m.component_code.toUpperCase();
      if (code !== a && code !== b) continue;
      if (!map.has(m.wip_code)) map.set(m.wip_code, { qtyA: null, qtyB: null });
      const entry = map.get(m.wip_code)!;
      if (code === a) entry.qtyA = m.qty_per_wip;
      if (code === b) entry.qtyB = m.qty_per_wip;
    }

    return Array.from(map.entries())
      .map(([wipCode, { qtyA, qtyB }]) => ({
        wipCode,
        qtyA,
        qtyB,
        status: qtyA != null && qtyB != null
          ? qtyA === qtyB ? 'match' : 'qty_mismatch'
          : qtyA == null ? 'a_missing' : 'b_missing',
      } as CompareRow))
      .sort((a, b) => {
        const order = { b_missing: 0, a_missing: 1, qty_mismatch: 2, match: 3 };
        return order[a.status] - order[b.status];
      });
  }, [mappings, codeA, codeB]);

  const hasResults = codeA.length >= 3 && codeB.length >= 3;
  const aCount = results.filter(r => r.qtyA != null).length;
  const bCount = results.filter(r => r.qtyB != null).length;
  const mismatches = results.filter(r => r.status !== 'match').length;

  const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    match:        { bg: 'var(--success-light)', text: 'var(--success)', label: 'Match' },
    qty_mismatch: { bg: 'var(--accent-light)',  text: 'var(--warning)', label: 'Qty Diff' },
    a_missing:    { bg: 'var(--error-light)',   text: 'var(--error)',   label: 'A Missing' },
    b_missing:    { bg: 'var(--error-light)',   text: 'var(--error)',   label: 'B Missing' },
  };

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--card-border)', background: 'rgba(37,99,235,0.03)' }}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-[var(--primary)] flex items-center justify-center">
            <ArrowRight size={11} className="text-white" />
          </div>
          <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Compare Components</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-[var(--muted)] transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Inputs */}
      <div className="px-4 py-3 flex items-end gap-3 border-b" style={{ borderColor: 'var(--card-border-light)' }}>
        <div className="flex-1">
          <label className="text-[10px] font-semibold text-[var(--primary)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Component A</label>
          <ComponentSearch value={codeA} onChange={onCodeAChange} placeholder="e.g. XM400-01A01" autoFocus />
        </div>
        <div className="pb-2 text-[var(--muted-light)]"><ArrowRight size={14} /></div>
        <div className="flex-1">
          <label className="text-[10px] font-semibold text-[var(--primary)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Component B</label>
          <ComponentSearch value={codeB} onChange={onCodeBChange} placeholder="e.g. XM400-01B01" />
        </div>
      </div>

      {/* Results */}
      {hasResults && results.length > 0 && (
        <>
          <div className="px-4 py-2 text-xs text-[var(--muted)] border-b" style={{ borderColor: 'var(--card-border-light)' }}>
            A in <strong>{aCount}</strong> WIPs, B in <strong>{bCount}</strong> WIPs.
            {mismatches > 0
              ? <span className="text-[var(--error)] ml-1 font-medium">{mismatches} difference{mismatches !== 1 ? 's' : ''} found</span>
              : <span className="text-[var(--success)] ml-1 font-medium">All matching</span>
            }
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>WIP Code</th>
                  <th className="w-24 text-right">A Qty</th>
                  <th className="w-24 text-right">B Qty</th>
                  <th className="w-28">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const s = STATUS_STYLES[r.status];
                  return (
                    <tr key={r.wipCode}>
                      <td>
                        <button onClick={() => onSelectWip(r.wipCode)} className="font-mono text-xs font-medium text-[var(--primary)] hover:underline">
                          {r.wipCode}
                        </button>
                      </td>
                      <td className="text-right font-mono text-xs">{r.qtyA ?? <span className="text-[var(--error)]">—</span>}</td>
                      <td className="text-right font-mono text-xs">{r.qtyB ?? <span className="text-[var(--error)]">—</span>}</td>
                      <td>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: s.bg, color: s.text }}>
                          {r.status === 'match' ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hasResults && results.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-[var(--muted)]">
          No WIPs contain either component
        </div>
      )}

      {!hasResults && (
        <div className="px-4 py-6 text-center text-xs text-[var(--muted)]">
          Enter two component codes to compare their WIP usage
        </div>
      )}
    </div>
  );
}
