'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BomStatsBar } from '@/components/bom/BomStatsBar';
import { WipMasterList } from '@/components/bom/WipMasterList';
import { WipDetailPanel } from '@/components/bom/WipDetailPanel';
import { ComponentCompare } from '@/components/bom/ComponentCompare';
import {
  GitBranch, Upload, Loader, Plus, ArrowLeftRight, Link2,
  ChevronDown, ChevronRight, Trash2, Check, X, Pencil,
} from 'lucide-react';
import type { BomMapping, ComponentChain } from '@/types';

interface CatalogItem { part_number: string; description: string }

export default function BomPage() {
  const [mappings, setMappings]   = useState<BomMapping[]>([]);
  const [chains, setChains]       = useState<ComponentChain[]>([]);
  const [catalog, setCatalog]     = useState<CatalogItem[]>([]);
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
    const [wRes, cRes, catRes] = await Promise.all([
      fetch('/api/bom/mappings'),
      fetch('/api/bom/chains'),
      fetch('/api/components?active=true'),
    ]);
    if (wRes.ok) setMappings(await wRes.json());
    if (cRes.ok) setChains(await cRes.json());
    if (catRes.ok) setCatalog(await catRes.json());
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

  // Group chains by scanned_code for display
  const groupedChains = useMemo(() => {
    const map: Record<string, ComponentChain[]> = {};
    for (const c of chains) {
      if (!map[c.scanned_code]) map[c.scanned_code] = [];
      map[c.scanned_code].push(c);
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [chains]);

  // Catalog items for searchable dropdowns (Pastel inventory product codes + descriptions)
  const catalogItems = useMemo(() =>
    catalog.map(c => ({ code: c.part_number, description: c.description }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    [catalog],
  );

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
      <>
        <div className="p-8 flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
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
            <span className="badge badge-slate">{groupedChains.length}</span>
          </button>

          {showChains && (
            <div className="border-t" style={{ borderColor: 'var(--card-border)' }}>
              {showAddChain && (
                <div className="p-4 border-b" style={{ borderColor: 'var(--card-border)', background: 'rgba(37,99,235,0.03)' }}>
                  <AddChainForm
                    catalogItems={catalogItems}
                    onSave={async (data) => {
                      for (const credit of data.credits) {
                        await fetch('/api/bom/chains', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ scanned_code: data.scanned_code, also_credit_code: credit.code, credit_qty: credit.qty, notes: data.notes }),
                        });
                      }
                      await load();
                      setShowAddChain(false);
                    }}
                    onCancel={() => setShowAddChain(false)}
                  />
                </div>
              )}

              {/* Contextual action bar */}
              <div className="px-4 py-2 flex justify-end border-b" style={{ borderColor: 'var(--card-border-light)' }}>
                {!showAddChain ? (
                  <button onClick={() => setShowAddChain(true)} className="btn-primary text-xs py-1 px-3">
                    <Plus size={12} /> Add Chain
                  </button>
                ) : (
                  <span className="text-[10px] text-[var(--muted)] italic">Fill in the form above and click Save</span>
                )}
              </div>

              {groupedChains.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--muted)]">
                  No component chains configured
                </div>
              ) : (
                <ChainTable
                  groupedChains={groupedChains}
                  catalogItems={catalogItems}
                  onDelete={handleDeleteChain}
                  onUpdate={async (id, data) => {
                    const res = await fetch(`/api/bom/chains/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data),
                    });
                    if (res.ok) await load();
                  }}
                  onAddCredit={async (scannedCode, creditCode, notes, creditQty) => {
                    const res = await fetch('/api/bom/chains', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ scanned_code: scannedCode, also_credit_code: creditCode, credit_qty: creditQty ?? 1, notes }),
                    });
                    if (res.ok) await load();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Inline sub-components ───────────────────────────────────────────────────

function AddChainForm({ onSave, onCancel, catalogItems }: {
  onSave: (data: { scanned_code: string; credits: { code: string; qty: number }[]; notes?: string }) => Promise<void>;
  onCancel: () => void;
  catalogItems: { code: string; description: string }[];
}) {
  const [scanned, setScanned] = useState('');
  const [credits, setCredits] = useState<{ code: string; qty: number }[]>([{ code: '', qty: 1 }]);
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);

  const validCredits = credits.filter(c => c.code.trim());
  const canSave = scanned && validCredits.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ scanned_code: scanned, credits: validCredits, notes: notes || undefined });
    } finally {
      setSaving(false);
    }
  };

  const updateCreditCode = (idx: number, val: string) => {
    setCredits(prev => prev.map((c, i) => i === idx ? { ...c, code: val } : c));
  };
  const updateCreditQty = (idx: number, val: number) => {
    setCredits(prev => prev.map((c, i) => i === idx ? { ...c, qty: val } : c));
  };
  const addCreditRow = () => setCredits(prev => [...prev, { code: '', qty: 1 }]);
  const removeCreditRow = (idx: number) => setCredits(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>When Scanned</label>
          <SearchableCodeInput items={catalogItems} value={scanned} onChange={setScanned} placeholder="Search product code..." />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Notes</label>
          <input className="input text-xs" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex items-end gap-2 mb-1">
          <label className="flex-1 text-[10px] font-semibold text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>Also Credit</label>
          <label className="w-20 text-[10px] font-semibold text-[var(--muted)] text-center" style={{ fontFamily: 'var(--font-display)' }}>Qty</label>
          <div className="w-7" />
        </div>
        <div className="space-y-1.5">
          {credits.map((credit, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableCodeInput items={catalogItems} value={credit.code} onChange={v => updateCreditCode(idx, v)} placeholder="Search product code..." />
              </div>
              <div className="w-20">
                <input
                  type="number"
                  className="input font-mono text-xs text-center w-full"
                  value={credit.qty}
                  onChange={e => updateCreditQty(idx, parseFloat(e.target.value) || 1)}
                  min={0.01}
                  step="any"
                  title="Qty per scan"
                />
              </div>
              {credits.length > 1 && (
                <button onClick={() => removeCreditRow(idx)} className="p-1.5 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <button onClick={addCreditRow} className="text-[10px] text-[var(--primary)] font-medium flex items-center gap-1 hover:underline">
            <Plus size={10} /> Add another credit code
          </button>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button className="btn-primary text-xs py-1.5" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />} {saving ? 'Saving...' : 'Save Chain'}
        </button>
        <button className="btn-secondary text-xs py-1.5" onClick={onCancel} disabled={saving}>
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}

function ChainTable({ groupedChains, catalogItems, onDelete, onUpdate, onAddCredit }: {
  groupedChains: [string, ComponentChain[]][];
  catalogItems: { code: string; description: string }[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<ComponentChain>) => Promise<void>;
  onAddCredit: (scannedCode: string, creditCode: string, notes?: string, creditQty?: number) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editQty, setEditQty] = useState(1);
  const [editNotes, setEditNotes] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCredit, setNewCredit] = useState('');
  const [newCreditQty, setNewCreditQty] = useState(1);

  const [openCode, setOpenCode] = useState<string | null>(null);
  const descFor = (code: string) => catalogItems.find(i => i.code === code)?.description || '';

  const toggle = (code: string) => {
    setOpenCode(openCode === code ? null : code);
    setEditingId(null);
    setAddingTo(null);
  };

  return (
    <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
      {groupedChains.map(([scannedCode, items]) => {
        const isOpen = openCode === scannedCode;
        return (
          <div key={scannedCode}>
            {/* Collapsed header row */}
            <button
              onClick={() => toggle(scannedCode)}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-[var(--background-raised)] transition-colors"
            >
              {isOpen ? <ChevronDown size={12} className="text-[var(--muted)] shrink-0" /> : <ChevronRight size={12} className="text-[var(--muted)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <span className="font-mono text-xs font-medium">{scannedCode}</span>
                <span className="text-[10px] text-[var(--muted)] ml-2">{descFor(scannedCode)}</span>
              </div>
              <span className="text-[10px] text-[var(--muted)] shrink-0 truncate max-w-[300px]">
                → {items.map(c => `${c.also_credit_code}${(c.credit_qty ?? 1) !== 1 ? ` ×${c.credit_qty}` : ''}`).join(', ')}
              </span>
              <span className="badge badge-slate text-[10px] shrink-0">{items.length}</span>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="px-4 pb-3 pt-1 ml-7 border-l-2" style={{ borderColor: 'var(--primary)', background: 'rgba(37,99,235,0.02)' }}>
                <div className="space-y-1.5">
                  {items.map(c => (
                    <div key={c.id} className="flex items-start gap-2 py-1">
                      {editingId === c.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <div className="w-48 shrink-0"><SearchableCodeInput items={catalogItems} value={editCode} onChange={setEditCode} placeholder="Product code..." /></div>
                          <input type="number" className="input font-mono text-xs text-center w-14 shrink-0" value={editQty} onChange={e => setEditQty(parseFloat(e.target.value) || 1)} min={0.01} step="any" title="Qty" />
                          <input className="input text-xs flex-1" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes" />
                          <button onClick={async () => { await onUpdate(c.id, { also_credit_code: editCode, credit_qty: editQty, notes: editNotes || null }); setEditingId(null); }}
                            className="p-1 rounded hover:bg-green-50 text-[var(--success)]"><Check size={13} /></button>
                          <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-gray-100 text-[var(--muted)]"><X size={13} /></button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-xs font-medium" style={{ color: 'var(--primary)' }}>{c.also_credit_code}</span>
                            <span className="text-[10px] text-[var(--muted)] ml-2">{descFor(c.also_credit_code)}</span>
                            {(c.credit_qty ?? 1) !== 1 && (
                              <span className="text-[10px] font-mono font-semibold ml-1.5 px-1 py-0.5 rounded" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>×{c.credit_qty}</span>
                            )}
                          </div>
                          {c.notes && <span className="text-[10px] text-[var(--muted)] shrink-0">{c.notes}</span>}
                          <button onClick={() => { setEditingId(c.id); setEditCode(c.also_credit_code); setEditQty(c.credit_qty ?? 1); setEditNotes(c.notes || ''); }}
                            className="p-1 rounded hover:bg-blue-50 text-[var(--muted-light)] hover:text-[var(--primary)] transition-colors shrink-0"><Pencil size={12} /></button>
                          <button onClick={() => onDelete(c.id)}
                            className="p-1 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors shrink-0"><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  ))}

                  {/* Add credit row */}
                  {addingTo === scannedCode ? (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="w-48 shrink-0"><SearchableCodeInput items={catalogItems} value={newCredit} onChange={setNewCredit} placeholder="Product code..." /></div>
                      <input type="number" className="input font-mono text-xs text-center w-14 shrink-0" value={newCreditQty} onChange={e => setNewCreditQty(parseFloat(e.target.value) || 1)} min={0.01} step="any" title="Qty" />
                      <button onClick={async () => { if (newCredit) { await onAddCredit(scannedCode, newCredit, undefined, newCreditQty); setAddingTo(null); setNewCredit(''); setNewCreditQty(1); } }}
                        disabled={!newCredit} className="p-1 rounded hover:bg-green-50 text-[var(--success)] disabled:opacity-30"><Check size={13} /></button>
                      <button onClick={() => { setAddingTo(null); setNewCreditQty(1); }} className="p-1 rounded hover:bg-gray-100 text-[var(--muted)]"><X size={13} /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingTo(scannedCode); setNewCredit(''); setNewCreditQty(1); }}
                      className="text-[10px] text-[var(--primary)] font-medium flex items-center gap-1 hover:underline pt-1"
                    >
                      <Plus size={10} /> Add credit code
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SearchableCodeInput({ items, value, onChange, placeholder }: {
  items: { code: string; description: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Find description for the current value
  const selectedDesc = useMemo(() => {
    if (!value) return '';
    return items.find(i => i.code === value)?.description || '';
  }, [items, value]);

  const filtered = useMemo(() => {
    const q = (search || value).toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter(i => i.code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)).slice(0, 50);
  }, [items, search, value]);

  return (
    <div className="relative">
      <input
        className="input font-mono text-xs w-full"
        placeholder={placeholder}
        value={search || value}
        onChange={e => { setSearch(e.target.value); onChange(''); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {/* Show description of selected item */}
      {value && selectedDesc && !open && (
        <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate" title={selectedDesc}>
          {selectedDesc}
        </div>
      )}
      {open && filtered.length > 0 && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-lg border shadow-lg overflow-y-auto"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)', maxHeight: 240 }}
        >
          {filtered.map(item => (
            <button
              key={item.code}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--background)] transition-colors"
              style={{ color: item.code === value ? 'var(--primary)' : 'var(--foreground)' }}
              onMouseDown={() => { onChange(item.code); setSearch(''); setOpen(false); }}
            >
              <div className="text-xs font-mono font-medium">{item.code}</div>
              <div className="text-[10px] text-[var(--muted)] truncate">{item.description}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">No matches</div>
          )}
        </div>
      )}
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
