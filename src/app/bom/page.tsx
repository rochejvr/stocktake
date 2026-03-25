'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { BomStatsBar } from '@/components/bom/BomStatsBar';
import { WipMasterList } from '@/components/bom/WipMasterList';
import { WipDetailPanel } from '@/components/bom/WipDetailPanel';
import { ComponentCompare } from '@/components/bom/ComponentCompare';
import {
  GitBranch, Upload, Loader, Plus, ArrowLeftRight, Link2,
  ChevronDown, ChevronRight, Trash2, Check, X,
} from 'lucide-react';
import type { BomMapping, ComponentChain } from '@/types';

export default function BomPage() {
  const [mappings, setMappings]   = useState<BomMapping[]>([]);
  const [chains, setChains]       = useState<ComponentChain[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectedWip, setSelectedWip] = useState<string | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [showChains, setShowChains] = useState(false);
  const [showAddChain, setShowAddChain] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [wRes, cRes] = await Promise.all([
      fetch('/api/bom/mappings'),
      fetch('/api/bom/chains'),
    ]);
    if (wRes.ok) setMappings(await wRes.json());
    if (cRes.ok) setChains(await cRes.json());
    setLoading(false);
  }

  // Grouped for detail panel
  const grouped = useMemo(() => {
    const map: Record<string, BomMapping[]> = {};
    for (const m of mappings) {
      if (!map[m.wip_code]) map[m.wip_code] = [];
      map[m.wip_code].push(m);
    }
    return map;
  }, [mappings]);

  const selectedComponents = selectedWip ? (grouped[selectedWip] || []) : [];

  // Optimistic update helpers
  const handleSaveMapping = useCallback(async (id: string, data: Partial<BomMapping>) => {
    const res = await fetch(`/api/bom/mappings/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (res.ok) {
      const updated = await res.json();
      setMappings(prev => prev.map(m => m.id === id ? { ...m, ...updated } : m));
    }
  }, []);

  const handleDeleteMapping = useCallback(async (id: string) => {
    await fetch(`/api/bom/mappings/${id}`, { method: 'DELETE' });
    setMappings(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleDeleteWip = useCallback(async (wipCode: string) => {
    if (!confirm(`Delete WIP ${wipCode} and all its component mappings?`)) return;
    const res = await fetch(`/api/bom/mappings/wip/${encodeURIComponent(wipCode)}`, { method: 'DELETE' });
    if (res.ok) {
      setMappings(prev => prev.filter(m => m.wip_code !== wipCode));
      setSelectedWip(null);
    }
  }, []);

  const handleAddComponent = useCallback(async (data: { wip_code: string; component_code: string; qty_per_wip: number; notes?: string }) => {
    const res = await fetch('/api/bom/mappings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (res.ok) await load();
  }, []);

  const handleDeleteChain = useCallback(async (id: string) => {
    await fetch(`/api/bom/chains/${id}`, { method: 'DELETE' });
    setChains(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleSelectWipFromCompare = useCallback((wip: string) => {
    setSelectedWip(wip);
    setShowCompare(false);
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="p-8 flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-8 space-y-5 fade-in">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <GitBranch size={20} style={{ color: 'var(--primary)' }} />
              <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                BOM Mapping
              </h1>
            </div>
            <p className="text-sm text-[var(--muted)]">
              WIP-to-component mapping — persistent across stock takes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCompare(!showCompare)}
              className={`btn-secondary text-xs py-1.5 ${showCompare ? 'border-[var(--primary)] text-[var(--primary)]' : ''}`}
            >
              <ArrowLeftRight size={13} /> Compare
            </button>
            <BomImportButton onImported={load} />
          </div>
        </div>

        {/* Stats */}
        <BomStatsBar
          mappings={mappings}
          showMissingOnly={showMissingOnly}
          onToggleMissing={() => setShowMissingOnly(!showMissingOnly)}
        />

        {/* Compare panel */}
        {showCompare && (
          <ComponentCompare
            mappings={mappings}
            codeA={compareA}
            codeB={compareB}
            onCodeAChange={setCompareA}
            onCodeBChange={setCompareB}
            onClose={() => setShowCompare(false)}
            onSelectWip={handleSelectWipFromCompare}
          />
        )}

        {/* Master-Detail split */}
        <div className="flex gap-4" style={{ height: 'calc(100vh - 360px)', minHeight: '400px' }}>
          {/* Left: WIP list */}
          <div className="w-72 flex-shrink-0 card-elevated overflow-hidden">
            <WipMasterList
              mappings={mappings}
              search={search}
              onSearchChange={setSearch}
              selectedWip={selectedWip}
              onSelectWip={setSelectedWip}
              showMissingOnly={showMissingOnly}
              onClearMissing={() => setShowMissingOnly(false)}
            />
          </div>

          {/* Right: Detail panel */}
          <div className="flex-1 card-elevated overflow-hidden">
            {selectedWip && selectedComponents.length > 0 ? (
              <WipDetailPanel
                wipCode={selectedWip}
                components={selectedComponents}
                onSave={handleSaveMapping}
                onDelete={handleDeleteMapping}
                onDeleteWip={handleDeleteWip}
                onAddComponent={handleAddComponent}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--muted)]">
                <div className="text-center">
                  <GitBranch size={32} className="mx-auto mb-3 opacity-20" />
                  <div className="text-sm font-medium text-[var(--foreground)]">Select a WIP</div>
                  <div className="text-xs mt-1">Choose a WIP code from the list to view its components</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Component Chains — collapsible */}
        <div className="card">
          <button
            onClick={() => setShowChains(!showChains)}
            className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-[var(--background-raised)] transition-colors"
          >
            {showChains ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Link2 size={14} style={{ color: 'var(--primary)' }} />
            <span className="text-sm font-semibold">Component Chains</span>
            <span className="badge badge-slate">{chains.length}</span>
          </button>

          {showChains && (
            <div className="border-t" style={{ borderColor: 'var(--card-border)' }}>
              {showAddChain && (
                <div className="p-4 border-b" style={{ borderColor: 'var(--card-border)', background: 'rgba(37,99,235,0.03)' }}>
                  <AddChainForm
                    onSave={async (data) => {
                      const res = await fetch('/api/bom/chains', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
                      });
                      if (res.ok) { await load(); setShowAddChain(false); }
                    }}
                    onCancel={() => setShowAddChain(false)}
                  />
                </div>
              )}

              <div className="px-4 py-2 flex justify-end border-b" style={{ borderColor: 'var(--card-border-light)' }}>
                <button onClick={() => setShowAddChain(!showAddChain)} className="btn-primary text-xs py-1 px-3">
                  <Plus size={12} /> Add Chain
                </button>
              </div>

              {chains.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)]">
                  No component chains configured
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When Scanned</th>
                      <th>Also Credit</th>
                      <th className="w-48">Notes</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {chains.map(c => (
                      <tr key={c.id}>
                        <td><span className="font-mono text-xs font-medium">{c.scanned_code}</span></td>
                        <td><span className="font-mono text-xs font-medium" style={{ color: 'var(--primary)' }}>{c.also_credit_code}</span></td>
                        <td className="text-xs text-[var(--muted)]">{c.notes || '—'}</td>
                        <td>
                          <button onClick={() => handleDeleteChain(c.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ── Inline sub-components ───────────────────────────────────────────────────

function AddChainForm({ onSave, onCancel }: {
  onSave: (data: { scanned_code: string; also_credit_code: string; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [scanned, setScanned] = useState('');
  const [credit, setCredit]   = useState('');
  const [notes, setNotes]     = useState('');
  return (
    <div className="grid grid-cols-3 gap-3 items-end">
      <div>
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>When Scanned</label>
        <input className="input font-mono text-xs" placeholder="XM400-16B01" value={scanned} onChange={e => setScanned(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Also Credit</label>
        <input className="input font-mono text-xs" placeholder="XM400-16A01" value={credit} onChange={e => setCredit(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Notes</label>
        <input className="input text-xs" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="col-span-3 flex gap-2">
        <button className="btn-primary text-xs py-1.5"
          onClick={() => onSave({ scanned_code: scanned, also_credit_code: credit, notes: notes || undefined })}
          disabled={!scanned || !credit}>
          <Check size={12} /> Save
        </button>
        <button className="btn-secondary text-xs py-1.5" onClick={onCancel}>
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}

function BomImportButton({ onImported }: { onImported: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <label className="btn-secondary text-xs py-1.5 cursor-pointer">
      {loading ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />}
      Import Excel
      <input type="file" accept=".xlsx,.xls" className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setLoading(true);
          const fd = new FormData();
          fd.append('file', file);
          await fetch('/api/bom/import', { method: 'POST', body: fd });
          setLoading(false);
          onImported();
          e.target.value = '';
        }}
      />
    </label>
  );
}
