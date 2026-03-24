'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Plus, Trash2, Edit2, Check, X, GitBranch, Link2, Upload, Loader, Search } from 'lucide-react';
import type { BomMapping, ComponentChain } from '@/types';

type ActiveTab = 'wip' | 'chains';

export default function BomPage() {
  const [tab, setTab]             = useState<ActiveTab>('wip');
  const [mappings, setMappings]   = useState<BomMapping[]>([]);
  const [chains, setChains]       = useState<ComponentChain[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddWip, setShowAddWip]     = useState(false);
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

  async function deleteMapping(id: string) {
    await fetch(`/api/bom/mappings/${id}`, { method: 'DELETE' });
    setMappings(prev => prev.filter(m => m.id !== id));
  }

  async function deleteChain(id: string) {
    await fetch(`/api/bom/chains/${id}`, { method: 'DELETE' });
    setChains(prev => prev.filter(c => c.id !== id));
  }

  // Group WIP mappings by WIP code
  const groupedMappings = mappings.reduce<Record<string, BomMapping[]>>((acc, m) => {
    if (!acc[m.wip_code]) acc[m.wip_code] = [];
    acc[m.wip_code].push(m);
    return acc;
  }, {});

  const filteredWipCodes = Object.keys(groupedMappings).filter(wip =>
    !search || wip.toLowerCase().includes(search.toLowerCase()) ||
    groupedMappings[wip].some(m => m.component_code.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredChains = chains.filter(c =>
    !search ||
    c.scanned_code.toLowerCase().includes(search.toLowerCase()) ||
    c.also_credit_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              BOM Mapping
            </h1>
            <p className="text-[var(--muted)] text-sm mt-1">
              Define WIP-to-component relationships and component chain credits.
            </p>
          </div>
          <div className="flex gap-2">
            <BomImportButton onImported={load} />
            <button
              className="btn-primary"
              onClick={() => tab === 'wip' ? setShowAddWip(true) : setShowAddChain(true)}
            >
              <Plus size={14} />
              Add {tab === 'wip' ? 'WIP Mapping' : 'Chain'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-slate-100 rounded-lg w-fit">
          <TabButton active={tab === 'wip'} onClick={() => setTab('wip')} icon={<GitBranch size={14} />}>
            WIP → Components
            <span className="ml-1.5 badge badge-blue">{Object.keys(groupedMappings).length}</span>
          </TabButton>
          <TabButton active={tab === 'chains'} onClick={() => setTab('chains')} icon={<Link2 size={14} />}>
            Component Chains
            <span className="ml-1.5 badge badge-amber">{chains.length}</span>
          </TabButton>
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
          <input
            className="input pl-8"
            placeholder={tab === 'wip' ? 'Search WIP or component code…' : 'Search code…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[var(--muted)] text-sm py-8">
            <Loader size={16} className="animate-spin" /> Loading…
          </div>
        )}

        {/* WIP Mappings */}
        {!loading && tab === 'wip' && (
          <div className="space-y-3">
            {showAddWip && (
              <AddWipMappingForm
                onSave={async (data) => {
                  const res = await fetch('/api/bom/mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  });
                  if (res.ok) { await load(); setShowAddWip(false); }
                }}
                onCancel={() => setShowAddWip(false)}
              />
            )}

            {filteredWipCodes.length === 0 && !showAddWip && (
              <EmptyState
                icon={<GitBranch size={32} />}
                title="No WIP mappings"
                description="Add WIP-to-component mappings or import from the BOM Excel file."
              />
            )}

            {filteredWipCodes.map(wipCode => (
              <div key={wipCode} className="card overflow-hidden">
                {/* WIP header */}
                <div className="px-4 py-3 bg-slate-50 border-b border-[var(--card-border)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-[var(--primary)]" />
                    <span className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                      {wipCode}
                    </span>
                    <span className="badge badge-blue">{groupedMappings[wipCode].length} component{groupedMappings[wipCode].length !== 1 ? 's' : ''}</span>
                  </div>
                  <button
                    onClick={() => setShowAddWip(true)}
                    className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Add component
                  </button>
                </div>

                {/* Components */}
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Component Code</th>
                      <th className="w-24 text-right">Qty / WIP</th>
                      <th className="w-48">Notes</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedMappings[wipCode].map(m => (
                      <MappingRow
                        key={m.id}
                        mapping={m}
                        editing={editingId === m.id}
                        onEdit={() => setEditingId(m.id)}
                        onCancelEdit={() => setEditingId(null)}
                        onSave={async (updated) => {
                          const res = await fetch(`/api/bom/mappings/${m.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updated),
                          });
                          if (res.ok) { await load(); setEditingId(null); }
                        }}
                        onDelete={() => deleteMapping(m.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Component Chains */}
        {!loading && tab === 'chains' && (
          <div className="card overflow-hidden">
            {showAddChain && (
              <div className="p-4 border-b border-[var(--card-border)] bg-blue-50">
                <AddChainForm
                  onSave={async (data) => {
                    const res = await fetch('/api/bom/chains', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data),
                    });
                    if (res.ok) { await load(); setShowAddChain(false); }
                  }}
                  onCancel={() => setShowAddChain(false)}
                />
              </div>
            )}

            {filteredChains.length === 0 && !showAddChain ? (
              <EmptyState
                icon={<Link2 size={32} />}
                title="No component chains"
                description="Component chains credit additional parts when a specific code is scanned. E.g. scanning XM400-16B01 also credits XM400-16A01."
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When this is scanned</th>
                    <th>Also credit</th>
                    <th className="w-48">Notes</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChains.map(c => (
                    <tr key={c.id}>
                      <td>
                        <span className="font-mono text-sm text-[var(--foreground)]">{c.scanned_code}</span>
                      </td>
                      <td>
                        <span className="font-mono text-sm text-[var(--primary)]">{c.also_credit_code}</span>
                      </td>
                      <td className="text-[var(--muted)] text-xs">{c.notes || '—'}</td>
                      <td>
                        <button onClick={() => deleteChain(c.id)} className="text-[var(--muted-light)] hover:text-[var(--error)] transition-colors p-1">
                          <Trash2 size={14} />
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
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? 'bg-white shadow-sm text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
      }`}
    >
      {icon}{children}
    </button>
  );
}

function MappingRow({ mapping, editing, onEdit, onCancelEdit, onSave, onDelete }: {
  mapping: BomMapping;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: Partial<BomMapping>) => void;
  onDelete: () => void;
}) {
  const [qty, setQty]     = useState(mapping.qty_per_wip);
  const [notes, setNotes] = useState(mapping.notes || '');

  if (editing) return (
    <tr className="bg-blue-50">
      <td><span className="font-mono text-sm">{mapping.component_code}</span></td>
      <td>
        <input type="number" className="input w-20 text-right" value={qty}
          onChange={e => setQty(+e.target.value)} min={0.001} step={1} />
      </td>
      <td>
        <input className="input text-xs" value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="Optional note" />
      </td>
      <td>
        <div className="flex gap-1">
          <button onClick={() => onSave({ qty_per_wip: qty, notes: notes || null })}
            className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
          <button onClick={onCancelEdit}
            className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]"><X size={14} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr>
      <td><span className="font-mono text-sm">{mapping.component_code}</span></td>
      <td className="text-right font-mono text-sm">{mapping.qty_per_wip}</td>
      <td className="text-[var(--muted)] text-xs">{mapping.notes || '—'}</td>
      <td>
        <div className="flex gap-1">
          <button onClick={onEdit} className="p-1 text-[var(--muted-light)] hover:text-[var(--primary)] transition-colors">
            <Edit2 size={14} />
          </button>
          <button onClick={onDelete} className="p-1 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddWipMappingForm({ onSave, onCancel }: {
  onSave: (data: { wip_code: string; component_code: string; qty_per_wip: number; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [wip, setWip]   = useState('');
  const [comp, setComp] = useState('');
  const [qty, setQty]   = useState(1);
  const [notes, setNotes] = useState('');

  return (
    <div className="card p-4 border-2 border-[var(--primary)] border-dashed">
      <div className="text-xs font-semibold text-[var(--primary)] mb-3">New WIP Mapping</div>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">WIP Code</label>
          <input className="input font-mono text-sm" placeholder="WIP230002" value={wip} onChange={e => setWip(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">Component Code</label>
          <input className="input font-mono text-sm" placeholder="XM400-01B01-02" value={comp} onChange={e => setComp(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">Qty / WIP</label>
          <input type="number" className="input" value={qty} onChange={e => setQty(+e.target.value)} min={0.001} step={1} />
        </div>
        <div>
          <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">Notes</label>
          <input className="input text-xs" placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn-primary text-xs py-1.5"
          onClick={() => onSave({ wip_code: wip, component_code: comp, qty_per_wip: qty, notes: notes || undefined })}
          disabled={!wip || !comp || qty <= 0}>
          <Check size={12} /> Save
        </button>
        <button className="btn-secondary text-xs py-1.5" onClick={onCancel}>
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}

function AddChainForm({ onSave, onCancel }: {
  onSave: (data: { scanned_code: string; also_credit_code: string; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [scanned, setScanned]   = useState('');
  const [credit, setCredit]     = useState('');
  const [notes, setNotes]       = useState('');
  return (
    <div className="grid grid-cols-3 gap-3 items-end">
      <div>
        <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">When this is scanned</label>
        <input className="input font-mono text-sm" placeholder="XM400-16B01-0401" value={scanned} onChange={e => setScanned(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">Also credit</label>
        <input className="input font-mono text-sm" placeholder="XM400-16A01-0401" value={credit} onChange={e => setCredit(e.target.value)} />
      </div>
      <div>
        <label className="text-[10px] text-[var(--muted)] font-medium block mb-1">Notes</label>
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
    <label className="btn-secondary cursor-pointer">
      {loading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
      Import Excel BOM
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

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="text-center py-16 text-[var(--muted)]">
      <div className="flex justify-center mb-3 opacity-20">{icon}</div>
      <div className="font-medium text-[var(--foreground)] mb-1">{title}</div>
      <div className="text-sm max-w-sm mx-auto">{description}</div>
    </div>
  );
}
