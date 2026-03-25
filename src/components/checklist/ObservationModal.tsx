'use client';

import { useState } from 'react';
import { X, AlertTriangle, Shield, Lightbulb } from 'lucide-react';
import type { ChecklistObservation, ChecklistItem, ObservationStatus } from '@/types';

interface ObservationModalProps {
  observation?: ChecklistObservation | null;
  checklistItem?: ChecklistItem | null;
  stockTakeId: string;
  phase: string;
  department: string;
  userName: string;
  userId: string;
  onSave: (data: any) => void;
  onClose: () => void;
}

export function ObservationModal({
  observation,
  checklistItem,
  stockTakeId,
  phase,
  department,
  userName,
  onSave,
  onClose,
}: ObservationModalProps) {
  const isEdit = !!observation;
  const [issue, setIssue] = useState(observation?.issue_description || '');
  const [corrective, setCorrective] = useState(observation?.corrective_action || '');
  const [preventive, setPreventive] = useState(observation?.preventive_action || '');
  const [status, setStatus] = useState<ObservationStatus>(observation?.status || 'open');
  const [saving, setSaving] = useState(false);

  const canClose = corrective.trim() && preventive.trim();
  const closingWithoutFields = status === 'closed' && !canClose;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (closingWithoutFields) return;
    setSaving(true);

    if (isEdit) {
      onSave({
        id: observation.id,
        issue_description: issue,
        corrective_action: corrective || null,
        preventive_action: preventive || null,
        status,
        closed_by: status === 'closed' ? userName : undefined,
      });
    } else {
      onSave({
        stock_take_id: stockTakeId,
        checklist_item_id: checklistItem?.id || null,
        phase,
        department,
        issue_description: issue,
        corrective_action: corrective || null,
        preventive_action: preventive || null,
        reported_by: userName,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
            <h3 className="font-semibold text-sm">
              {isEdit ? 'Edit Observation' : 'Log Observation'}
            </h3>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Context */}
        {checklistItem && (
          <div className="px-4 pt-3">
            <div className="text-xs px-2.5 py-1.5 rounded-md" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              Re: {checklistItem.item_text}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Issue */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
              <AlertTriangle size={12} />
              Issue / Observation <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <textarea
              className="input min-h-[80px] resize-y"
              placeholder="Describe what was found..."
              value={issue}
              onChange={e => setIssue(e.target.value)}
              required
            />
          </div>

          {/* Corrective Action */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
              <Shield size={12} />
              Corrective Action (immediate)
              {isEdit && status === 'closed' && <span style={{ color: 'var(--error)' }}>*</span>}
            </label>
            <textarea
              className="input min-h-[60px] resize-y"
              placeholder="What was done to fix this now?"
              value={corrective}
              onChange={e => setCorrective(e.target.value)}
            />
          </div>

          {/* Preventive Action */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
              <Lightbulb size={12} />
              Preventive Action (future)
              {isEdit && status === 'closed' && <span style={{ color: 'var(--error)' }}>*</span>}
            </label>
            <textarea
              className="input min-h-[60px] resize-y"
              placeholder="What should change to prevent recurrence?"
              value={preventive}
              onChange={e => setPreventive(e.target.value)}
            />
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>
                Status
              </label>
              <select
                className="input"
                value={status}
                onChange={e => setStatus(e.target.value as ObservationStatus)}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="closed">Closed</option>
              </select>
              {closingWithoutFields && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--error)' }}>
                  Corrective and preventive actions are required before closing.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving || !issue.trim() || closingWithoutFields} className="btn-primary">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Log Observation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
