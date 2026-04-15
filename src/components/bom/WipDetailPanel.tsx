'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, AlertTriangle, GitBranch } from 'lucide-react';
import { ComponentSearch } from '@/components/shared/ComponentSearch';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { BomMapping } from '@/types';

interface WipDetailPanelProps {
  wipCode: string;
  components: BomMapping[];
  onSave: (id: string, data: Partial<BomMapping>) => void;
  onDelete: (id: string) => void;
  onDeleteWip: (wipCode: string) => void;
  onAddComponent: (data: { wip_code: string; component_code: string; qty_per_wip: number; notes?: string }) => void;
}

export function WipDetailPanel({ wipCode, components, onSave, onDelete, onDeleteWip, onAddComponent }: WipDetailPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BomMapping | null>(null);
  const hasMissing = components.some(c => c.missing_from_inventory);
  const missingN = components.filter(c => c.missing_from_inventory).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--card-border)' }}>
        <div className="flex items-center gap-3">
          <GitBranch size={16} style={{ color: 'var(--primary)' }} />
          <div>
            <div className="font-mono text-sm font-bold">{wipCode}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">
              {components.length} component{components.length !== 1 ? 's' : ''}
              {hasMissing && (
                <span className="text-amber-600 ml-2">{missingN} missing from Pastel</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-xs py-1.5 px-3">
            <Plus size={12} /> Add Component
          </button>
          <button
            onClick={() => onDeleteWip(wipCode)}
            className="btn-secondary text-xs py-1.5 px-3 text-[var(--muted)] hover:text-[var(--error)] hover:border-[var(--error)]"
          >
            <Trash2 size={12} /> Delete WIP
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <AddComponentInline
          wipCode={wipCode}
          onSave={data => { onAddComponent(data); setShowAdd(false); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Component table */}
      <div className="flex-1 overflow-y-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Component Code</th>
              <th>Description</th>
              <th className="w-24 text-right">Qty / WIP</th>
              <th className="w-44">Notes</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {components.map(m => (
              editingId === m.id ? (
                <EditRow
                  key={m.id}
                  mapping={m}
                  onSave={data => { onSave(m.id, data); setEditingId(null); }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ViewRow
                  key={m.id}
                  mapping={m}
                  onEdit={() => setEditingId(m.id)}
                  onDelete={() => setDeleteTarget(m)}
                />
              )
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Component"
        message={deleteTarget ? `Remove ${deleteTarget.component_code} from this WIP? This will affect how scans of this WIP are counted.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ViewRow({ mapping, onEdit, onDelete }: { mapping: BomMapping; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr style={{ background: mapping.missing_from_inventory ? '#fffbeb' : undefined }}>
      <td>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-medium">{mapping.component_code}</span>
          {mapping.missing_from_inventory && (
            <span title="Not in Pastel"><AlertTriangle size={12} className="text-amber-500" /></span>
          )}
        </div>
      </td>
      <td className="text-xs text-[var(--muted)]">
        {mapping.component_description || <span className="italic text-[var(--muted-light)]">no description</span>}
      </td>
      <td className="text-right font-mono text-xs font-medium">{mapping.qty_per_wip}</td>
      <td className="text-xs text-[var(--muted)]">{mapping.notes || '—'}</td>
      <td>
        <div className="flex gap-1 justify-end">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-blue-50 text-[var(--muted-light)] hover:text-[var(--primary)] transition-colors">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-50 text-[var(--muted-light)] hover:text-[var(--error)] transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function EditRow({ mapping, onSave, onCancel }: { mapping: BomMapping; onSave: (data: Partial<BomMapping>) => void; onCancel: () => void }) {
  const [qty, setQty] = useState(mapping.qty_per_wip);
  const [notes, setNotes] = useState(mapping.notes || '');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSave({ qty_per_wip: qty, notes: notes || null });
    if (e.key === 'Escape') onCancel();
  };

  return (
    <tr style={{ background: 'rgba(37,99,235,0.04)' }}>
      <td><span className="font-mono text-xs font-medium">{mapping.component_code}</span></td>
      <td className="text-xs text-[var(--muted)]">{mapping.component_description || '—'}</td>
      <td>
        <input type="number" className="input w-20 text-right text-xs" value={qty}
          onChange={e => setQty(+e.target.value)} min={0.001} step={1} autoFocus onKeyDown={handleKeyDown} />
      </td>
      <td>
        <input className="input text-xs" value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="Notes..." onKeyDown={handleKeyDown} />
      </td>
      <td>
        <div className="flex gap-1 justify-end">
          <button onClick={() => onSave({ qty_per_wip: qty, notes: notes || null })}
            className="p-1.5 rounded hover:bg-green-50 text-green-600 transition-colors"><Check size={13} /></button>
          <button onClick={onCancel}
            className="p-1.5 rounded hover:bg-slate-100 text-[var(--muted)] transition-colors"><X size={13} /></button>
        </div>
      </td>
    </tr>
  );
}

function AddComponentInline({ wipCode, onSave, onCancel }: {
  wipCode: string;
  onSave: (data: { wip_code: string; component_code: string; qty_per_wip: number; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [comp, setComp] = useState('');
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  return (
    <div className="px-5 py-3 border-b flex items-end gap-3" style={{ borderColor: 'var(--card-border)', background: 'rgba(37,99,235,0.03)' }}>
      <div className="flex-1 min-w-0">
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Component</label>
        <ComponentSearch value={comp} onChange={setComp} autoFocus />
      </div>
      <div className="w-20">
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Qty</label>
        <input type="number" className="input text-xs text-right" value={qty} onChange={e => setQty(+e.target.value)} min={0.001} step={1} />
      </div>
      <div className="w-36">
        <label className="text-[10px] font-semibold text-[var(--muted)] block mb-1" style={{ fontFamily: 'var(--font-display)' }}>Notes</label>
        <input className="input text-xs" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
      </div>
      <button className="btn-primary text-xs py-[0.4rem] px-3"
        onClick={() => onSave({ wip_code: wipCode, component_code: comp, qty_per_wip: qty, notes: notes || undefined })}
        disabled={!comp || qty <= 0}>
        <Check size={12} /> Add
      </button>
      <button className="btn-secondary text-xs py-[0.4rem] px-3" onClick={onCancel}>
        <X size={12} />
      </button>
    </div>
  );
}
