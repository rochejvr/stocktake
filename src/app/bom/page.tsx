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

  const descFor = useCallback((code: string) =>
    catalogItems.find(i => i.code === code)?.description || '',
    [catalogItems],
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

        {/* Component Chains */}
        <div className="card">
          <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--card-border)' }}>
            <button onClick={() => setShowChains(!showChains)} className="flex items-center gap-2 hover:opacity-80">
              {showChains ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Link2 size={14} style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-semibold">Component Chains</span>
              <span className="badge badge-slate">{groupedChains.length}</span>
            </button>
            {showChains && !showAddChain && (
              <button onClick={() => setShowAddChain(true)} className="btn-primary text-xs py-1 px-3">
                <Plus size={12} /> New Chain
              </button>
            )}
          </div>

          {showChains && (
            <div>
              {showAddChain && (
                <AddChainForm
                  catalogItems={catalogItems}
                  descFor={descFor}
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
              )}

              {groupedChains.length === 0 && !showAddChain ? (
                <div className="py-10 text-center">
                  <Link2 size={24} className="mx-auto mb-2 opacity-15" />
                  <div className="text-xs text-[var(--muted)]">No component chains configured</div>
                </div>
              ) : (
                <ChainAccordion
                  groupedChains={groupedChains}
                  catalogItems={catalogItems}
                  descFor={descFor}
                  onDelete={handleDeleteChain}
                  onUpdate={async (id, data) => {
                    const res = await fetch(`/api/bom/chains/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data),
                    });
                    if (res.ok) await load();
                  }}
                  onAddCredit={async (scannedCode, creditCode, creditQty, notes) => {
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

// ── Add Chain Form ─────────────────────────────────────────────────────────
function AddChainForm({ onSave, onCancel, catalogItems, descFor }: {
  onSave: (data: { scanned_code: string; credits: { code: string; qty: number }[]; notes?: string }) => Promise<void>;
  onCancel: () => void;
  catalogItems: { code: string; description: string }[];
  descFor: (code: string) => string;
}) {
  const [scanned, setScanned] = useState('');
  const [credits, setCredits] = useState<{ code: string; qty: number }[]>([{ code: '', qty: 1 }]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const validCredits = credits.filter(c => c.code.trim());
  const canSave = scanned && validCredits.length > 0;

  return (
    <div className="p-4 border-b" style={{ borderColor: 'var(--card-border)', background: 'var(--background)' }}>
      <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">New Chain</div>

      {/* Scanned product */}
      <div className="mb-3">
        <label className="text-[10px] font-medium text-[var(--muted)] mb-1 block">When this product is scanned</label>
        <div className="max-w-xs">
          <SearchableCodeInput items={catalogItems} value={scanned} onChange={setScanned} placeholder="Search product code..." />
        </div>
        {scanned && <div className="text-[10px] text-[var(--muted)] mt-0.5 ml-0.5">{descFor(scanned)}</div>}
      </div>

      {/* Credit items */}
      <div className="mb-3">
        <label className="text-[10px] font-medium text-[var(--muted)] mb-2 block">Also credit these products</label>
        <div className="space-y-2">
          {credits.map((credit, idx) => (
            <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg border" style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}>
              <div className="flex-1 min-w-0">
                <div className="max-w-xs">
                  <SearchableCodeInput items={catalogItems} value={credit.code} onChange={v => setCredits(prev => prev.map((c, i) => i === idx ? { ...c, code: v } : c))} placeholder="Search product code..." />
                </div>
                {credit.code && <div className="text-[10px] text-[var(--muted)] mt-0.5 ml-0.5">{descFor(credit.code)}</div>}
              </div>
              <div className="shrink-0 text-center">
                <label className="text-[9px] text-[var(--muted)] block mb-0.5">Qty</label>
                <input type="number" className="input font-mono text-xs text-center" style={{ width: 52 }}
                  value={credit.qty} onChange={e => setCredits(prev => prev.map((c, i) => i === idx ? { ...c, qty: parseFloat(e.target.value) || 1 } : c))}
                  min={0.01} step="any" />
              </div>
              {credits.length > 1 && (
                <button onClick={() => setCredits(prev => prev.filter((_, i) => i !== idx))}
                  className="p-1 mt-3 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors shrink-0">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setCredits(prev => [...prev, { code: '', qty: 1 }])}
            className="text-[10px] text-[var(--primary)] font-medium flex items-center gap-1 hover:underline ml-1">
            <Plus size={10} /> Add another product
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="mb-4 max-w-sm">
        <label className="text-[10px] font-medium text-[var(--muted)] mb-1 block">Notes (optional)</label>
        <input className="input text-xs" placeholder="e.g. Pack of 10 electrodes" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="btn-primary text-xs py-1.5 px-4" disabled={!canSave || saving}
          onClick={async () => { setSaving(true); try { await onSave({ scanned_code: scanned, credits: validCredits, notes: notes || undefined }); } finally { setSaving(false); } }}>
          {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
          {saving ? 'Saving...' : 'Save Chain'}
        </button>
        <button className="btn-secondary text-xs py-1.5 px-4" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}

// ── Chain Accordion ───────────────────────────────────────────────────────
function ChainAccordion({ groupedChains, catalogItems, descFor, onDelete, onUpdate, onAddCredit }: {
  groupedChains: [string, ComponentChain[]][];
  catalogItems: { code: string; description: string }[];
  descFor: (code: string) => string;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<ComponentChain>) => Promise<void>;
  onAddCredit: (scannedCode: string, creditCode: string, creditQty: number, notes?: string) => Promise<void>;
}) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState({ code: '', qty: 1, notes: '' });
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addState, setAddState] = useState({ code: '', qty: 1 });

  const toggle = (code: string) => {
    setOpenCode(prev => prev === code ? null : code);
    setEditingId(null);
    setAddingTo(null);
  };

  const startEdit = (c: ComponentChain) => {
    setEditingId(c.id);
    setEditState({ code: c.also_credit_code, qty: c.credit_qty ?? 1, notes: c.notes || '' });
  };

  return (
    <div>
      {groupedChains.map(([scannedCode, items]) => {
        const isOpen = openCode === scannedCode;
        return (
          <div key={scannedCode} className="border-t" style={{ borderColor: 'var(--card-border)' }}>
            {/* Header */}
            <button onClick={() => toggle(scannedCode)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--background-raised)] transition-colors">
              <div className="shrink-0" style={{ color: isOpen ? 'var(--primary)' : 'var(--muted)' }}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mono text-xs font-semibold">{scannedCode}</span>
                <span className="text-[10px] text-[var(--muted)] ml-2">{descFor(scannedCode)}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-[var(--muted)]">→</span>
                {items.slice(0, 3).map(c => (
                  <span key={c.id} className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
                    {c.also_credit_code}{(c.credit_qty ?? 1) !== 1 ? ` ×${c.credit_qty}` : ''}
                  </span>
                ))}
                {items.length > 3 && <span className="text-[10px] text-[var(--muted)]">+{items.length - 3}</span>}
              </div>
            </button>

            {/* Expanded */}
            {isOpen && (
              <div className="pb-3 px-4">
                <div className="ml-3 pl-4 border-l-2 space-y-2" style={{ borderColor: 'var(--primary)' }}>
                  {items.map(c => (
                    <div key={c.id}>
                      {editingId === c.id ? (
                        /* ── Edit mode ── */
                        <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--primary)', background: 'rgba(37,99,235,0.03)' }}>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <label className="text-[9px] text-[var(--muted)] block mb-0.5">Product Code</label>
                              <div className="max-w-xs">
                                <SearchableCodeInput items={catalogItems} value={editState.code} onChange={v => setEditState(s => ({ ...s, code: v }))} placeholder="Code..." />
                              </div>
                              {editState.code && <div className="text-[10px] text-[var(--muted)] mt-0.5">{descFor(editState.code)}</div>}
                            </div>
                            <div className="shrink-0 text-center">
                              <label className="text-[9px] text-[var(--muted)] block mb-0.5">Qty</label>
                              <input type="number" className="input font-mono text-xs text-center" style={{ width: 52 }}
                                value={editState.qty} onChange={e => setEditState(s => ({ ...s, qty: parseFloat(e.target.value) || 1 }))} min={0.01} step="any" />
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] text-[var(--muted)] block mb-0.5">Notes</label>
                            <input className="input text-xs max-w-xs" value={editState.notes} onChange={e => setEditState(s => ({ ...s, notes: e.target.value }))} placeholder="Optional" />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button className="btn-primary text-[10px] py-1 px-3"
                              onClick={async () => { await onUpdate(c.id, { also_credit_code: editState.code, credit_qty: editState.qty, notes: editState.notes || null }); setEditingId(null); }}>
                              <Check size={11} /> Save
                            </button>
                            <button className="btn-secondary text-[10px] py-1 px-3" onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        /* ── Display mode ── */
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--background-raised)] transition-colors group">
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-xs font-medium" style={{ color: 'var(--primary)' }}>{c.also_credit_code}</span>
                            <span className="text-[10px] text-[var(--muted)] ml-2">{descFor(c.also_credit_code)}</span>
                          </div>
                          {(c.credit_qty ?? 1) !== 1 && (
                            <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                              style={{ background: 'var(--background)', color: 'var(--foreground)' }}>×{c.credit_qty}</span>
                          )}
                          {c.notes && <span className="text-[10px] text-[var(--muted)] shrink-0 hidden sm:inline">{c.notes}</span>}
                          <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(c)} className="p-1 rounded hover:bg-blue-50 text-[var(--muted-light)] hover:text-[var(--primary)]"><Pencil size={12} /></button>
                            <button onClick={() => onDelete(c.id)} className="p-1 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)]"><Trash2 size={12} /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add credit */}
                  {addingTo === scannedCode ? (
                    <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--card-border)', background: 'var(--background)' }}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <label className="text-[9px] text-[var(--muted)] block mb-0.5">Product Code</label>
                          <div className="max-w-xs">
                            <SearchableCodeInput items={catalogItems} value={addState.code} onChange={v => setAddState(s => ({ ...s, code: v }))} placeholder="Search product code..." />
                          </div>
                          {addState.code && <div className="text-[10px] text-[var(--muted)] mt-0.5">{descFor(addState.code)}</div>}
                        </div>
                        <div className="shrink-0 text-center">
                          <label className="text-[9px] text-[var(--muted)] block mb-0.5">Qty</label>
                          <input type="number" className="input font-mono text-xs text-center" style={{ width: 52 }}
                            value={addState.qty} onChange={e => setAddState(s => ({ ...s, qty: parseFloat(e.target.value) || 1 }))} min={0.01} step="any" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-primary text-[10px] py-1 px-3" disabled={!addState.code}
                          onClick={async () => { await onAddCredit(scannedCode, addState.code, addState.qty); setAddingTo(null); setAddState({ code: '', qty: 1 }); }}>
                          <Check size={11} /> Add
                        </button>
                        <button className="btn-secondary text-[10px] py-1 px-3" onClick={() => { setAddingTo(null); setAddState({ code: '', qty: 1 }); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingTo(scannedCode); setAddState({ code: '', qty: 1 }); }}
                      className="text-[10px] text-[var(--primary)] font-medium flex items-center gap-1 hover:underline ml-2 py-1">
                      <Plus size={10} /> Add credit
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
