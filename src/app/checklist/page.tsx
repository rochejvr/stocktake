'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ObservationModal } from '@/components/checklist/ObservationModal';
import {
  ClipboardList, Check, AlertTriangle, Shield, ChevronDown, ChevronRight,
  Plus, FileCheck, Lock, Eye, MessageSquare, Lightbulb,
} from 'lucide-react';
import type {
  ChecklistItem, ChecklistObservation, ChecklistSignoff,
  ChecklistPhase, Department, StockTake,
} from '@/types';
import { PHASE_LABELS, DEPARTMENTS } from '@/types';

const PHASE_ORDER: ChecklistPhase[] = ['pre', 'during', 'post'];

const DEPT_COLORS: Record<Department, { bg: string; text: string }> = {
  Finance:     { bg: 'var(--primary-light)', text: 'var(--primary)' },
  Production:  { bg: 'var(--accent-light)',  text: 'var(--warning)' },
  Procurement: { bg: 'var(--success-light)', text: 'var(--success)' },
};

const OBS_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:        { bg: 'var(--error-light)', text: 'var(--error)' },
  in_progress: { bg: 'var(--accent-light)', text: 'var(--warning)' },
  closed:      { bg: 'var(--success-light)', text: 'var(--success)' },
};

const TEST_USER = { id: 'test-user', name: 'Test User' };

export default function ChecklistPage() {
  const currentUser = TEST_USER;
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [signoffs, setSignoffs] = useState<ChecklistSignoff[]>([]);
  const [observations, setObservations] = useState<ChecklistObservation[]>([]);
  const [activePhase, setActivePhase] = useState<ChecklistPhase>('pre');
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({
    Finance: true, Production: true, Procurement: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Observation modal
  const [obsModal, setObsModal] = useState<{
    open: boolean;
    observation?: ChecklistObservation | null;
    checklistItem?: ChecklistItem | null;
    department: Department;
  }>({ open: false, department: 'Finance' });

  const [viewObsItemId, setViewObsItemId] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const stRes = await fetch('/api/stock-takes/active');
      const stData = await stRes.json();
      if (!stData.stockTake) {
        setLoading(false);
        return;
      }
      setStockTake(stData.stockTake);

      const clRes = await fetch(`/api/checklist?stockTakeId=${stData.stockTake.id}`);
      const clData = await clRes.json();

      if (clData.items.length === 0) {
        await fetch('/api/checklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stockTakeId: stData.stockTake.id }),
        });
        const reloadRes = await fetch(`/api/checklist?stockTakeId=${stData.stockTake.id}`);
        const reloadData = await reloadRes.json();
        setItems(reloadData.items);
        setSignoffs(reloadData.signoffs);
        setObservations(reloadData.observations);
      } else {
        setItems(clData.items);
        setSignoffs(clData.signoffs);
        setObservations(clData.observations);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Toggle item completion
  const toggleItem = async (item: ChecklistItem) => {
    if (!currentUser || !stockTake) return;

    const phaseSignedOff = signoffs.some(
      s => s.phase === item.phase && s.department === item.department
    );
    if (phaseSignedOff) return;

    const isCompleting = !item.completed_at;
    const res = await fetch(`/api/checklist/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isCompleting
          ? {
              completed_by: currentUser.name,
              completed_at: new Date().toISOString(),
            }
          : { clear: true }
      ),
    });

    if (res.ok) {
      const updated = await res.json();
      setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    }
  };

  // Department phase sign-off
  const signOffPhase = async (phase: ChecklistPhase, department: Department) => {
    if (!currentUser || !stockTake) return;

    const res = await fetch('/api/checklist/signoffs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock_take_id: stockTake.id,
        phase,
        department,
        signed_by: currentUser.name,
      }),
    });

    if (res.ok) {
      const signoff = await res.json();
      setSignoffs(prev => [
        ...prev.filter(s => !(s.phase === phase && s.department === department)),
        signoff,
      ]);
    } else {
      const err = await res.json();
      setError(err.error);
      setTimeout(() => setError(''), 4000);
    }
  };

  // Observation CRUD
  const handleSaveObservation = async (data: any) => {
    if (data.id) {
      const res = await fetch(`/api/checklist/observations/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated = await res.json();
        setObservations(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      }
    } else {
      const res = await fetch('/api/checklist/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const created = await res.json();
        setObservations(prev => [created, ...prev]);
      }
    }
    setObsModal({ open: false, department: 'Finance' });
  };

  const handleDeleteObservation = async (obsId: string) => {
    if (!confirm('Delete this observation?')) return;
    const res = await fetch(`/api/checklist/observations/${obsId}`, { method: 'DELETE' });
    if (res.ok) {
      setObservations(prev => prev.filter(o => o.id !== obsId));
    }
  };

  // Helpers
  const phaseItems = items.filter(i => i.phase === activePhase);
  const deptItems = (dept: Department) => phaseItems.filter(i => i.department === dept);
  const deptComplete = (dept: Department) => {
    const di = deptItems(dept);
    return di.length > 0 && di.every(i => !!i.completed_at);
  };
  const deptSignedOff = (phase: ChecklistPhase, dept: Department) =>
    signoffs.some(s => s.phase === phase && s.department === dept);
  const itemObservations = (itemId: string) =>
    observations.filter(o => o.checklist_item_id === itemId);
  const openObsCount = (phase: ChecklistPhase, dept: Department) =>
    observations.filter(o => o.phase === phase && o.department === dept && o.status !== 'closed').length;
  const phaseProgress = (phase: ChecklistPhase) => {
    const pi = items.filter(i => i.phase === phase);
    const done = pi.filter(i => !!i.completed_at).length;
    return { done, total: pi.length };
  };

  if (loading) {
    return (
      <AppShell>
        <div className="p-8 flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!stockTake) {
    return (
      <AppShell>
        <div className="p-8 flex items-center justify-center h-64">
          <div className="text-center text-[var(--muted)]">
            <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
            <div className="font-medium text-[var(--foreground)]">No Active Stock Take</div>
            <div className="text-sm mt-1">Create a stock take in Setup to begin the checklist.</div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-8 space-y-6 fade-in">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <ClipboardList size={20} style={{ color: 'var(--primary)' }} />
              <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                Stock Take Checklist
              </h1>
            </div>
            <p className="text-sm text-[var(--muted)]">
              XAV-FIN-01SF — {stockTake.reference}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {PHASE_ORDER.map(phase => {
              const { done, total } = phaseProgress(phase);
              const allSignedOff = DEPARTMENTS.every(d => deptSignedOff(phase, d));
              return (
                <div key={phase} className="card px-3 py-2 text-center min-w-[4.5rem]">
                  <div className="text-[9px] font-semibold uppercase tracking-wider mb-0.5 text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>
                    {PHASE_LABELS[phase]}
                  </div>
                  {allSignedOff ? (
                    <div className="flex items-center justify-center gap-1">
                      <Lock size={11} style={{ color: 'var(--success)' }} />
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--success)' }}>Done</span>
                    </div>
                  ) : (
                    <div className="text-sm font-bold" style={{ fontFamily: 'var(--font-mono)', color: done === total && total > 0 ? 'var(--success)' : 'var(--foreground)' }}>
                      {done}/{total}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="alert-error">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Phase tabs */}
        <div className="tab-group">
          {PHASE_ORDER.map(phase => {
            const active = activePhase === phase;
            const { done, total } = phaseProgress(phase);
            return (
              <button
                key={phase}
                onClick={() => setActivePhase(phase)}
                className={`tab-btn ${active ? 'tab-btn-active' : ''}`}
              >
                {PHASE_LABELS[phase]}
                <span className={`badge ${done === total && total > 0 ? 'badge-green' : 'badge-slate'}`}>
                  {done}/{total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Department sections */}
        {DEPARTMENTS.map(dept => {
          const di = deptItems(dept);
          if (di.length === 0) return null;

          const completed = di.filter(i => !!i.completed_at).length;
          const isSignedOff = deptSignedOff(activePhase, dept);
          const canSign = deptComplete(dept) && !isSignedOff;
          const expanded = expandedDepts[dept] !== false;
          const colors = DEPT_COLORS[dept];
          const openObs = openObsCount(activePhase, dept);
          const signoff = signoffs.find(s => s.phase === activePhase && s.department === dept);

          return (
            <div key={dept} className="card overflow-hidden">
              {/* Department header */}
              <button
                onClick={() => setExpandedDepts(prev => ({ ...prev, [dept]: !expanded }))}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#f8fafc] transition-colors"
              >
                <div className="flex items-center gap-2 flex-1">
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{ background: colors.bg, color: colors.text }}
                  >
                    {dept}
                  </span>
                  <span className="text-sm font-medium">{completed}/{di.length} complete</span>
                </div>
                <div className="flex items-center gap-2">
                  {openObs > 0 && (
                    <span className="badge badge-red text-[10px]">{openObs} open obs</span>
                  )}
                  {isSignedOff ? (
                    <span className="badge badge-green flex items-center gap-1 text-[10px]">
                      <Lock size={10} /> Signed off by {signoff?.signed_by}
                    </span>
                  ) : (
                    <span className="badge badge-slate text-[10px]">Pending</span>
                  )}
                </div>
              </button>

              {expanded && (
                <div className="border-t" style={{ borderColor: 'var(--card-border-light)' }}>
                  {di.map(item => {
                    const isDone = !!item.completed_at;
                    const iObs = itemObservations(item.id);
                    const showObs = viewObsItemId === item.id;

                    return (
                      <div key={item.id}>
                        <div
                          className="flex items-start gap-3 px-4 py-3 border-b transition-colors"
                          style={{
                            borderColor: 'var(--card-border-light)',
                            background: isDone ? '#f0fdf4' : 'white',
                            opacity: isSignedOff ? 0.7 : 1,
                          }}
                        >
                          <button
                            onClick={() => toggleItem(item)}
                            disabled={isSignedOff}
                            className="mt-0.5 flex-shrink-0"
                            style={{ cursor: isSignedOff ? 'default' : 'pointer' }}
                          >
                            {isDone ? (
                              <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: 'var(--success)' }}>
                                <Check size={12} className="text-white" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded border-2" style={{ borderColor: 'var(--muted-light)' }} />
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="text-sm" style={{ color: isDone ? 'var(--muted)' : 'var(--foreground)' }}>
                              {item.item_text}
                            </div>
                            {isDone && item.completed_by && (
                              <div className="text-[11px] mt-1" style={{ color: 'var(--muted-light)' }}>
                                {item.completed_by} — {new Date(item.completed_at!).toLocaleDateString()}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            {iObs.length > 0 && (
                              <button
                                onClick={() => setViewObsItemId(showObs ? null : item.id)}
                                className="p-1.5 rounded hover:bg-[#f1f5f9] transition-colors relative"
                                title="View observations"
                              >
                                <Eye size={14} style={{ color: 'var(--muted)' }} />
                                <span
                                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                                  style={{ background: 'var(--warning)' }}
                                >
                                  {iObs.length}
                                </span>
                              </button>
                            )}
                            {!isSignedOff && (
                              <button
                                onClick={() => setObsModal({
                                  open: true,
                                  checklistItem: item,
                                  department: item.department as Department,
                                })}
                                className="p-1.5 rounded hover:bg-[#f1f5f9] transition-colors"
                                title="Log observation"
                              >
                                <MessageSquare size={14} style={{ color: 'var(--muted)' }} />
                              </button>
                            )}
                          </div>
                        </div>

                        {showObs && iObs.length > 0 && (
                          <div className="px-4 py-2 space-y-2" style={{ background: '#fefce8' }}>
                            {iObs.map(obs => (
                              <ObservationCard
                                key={obs.id}
                                observation={obs}
                                onEdit={() => setObsModal({
                                  open: true,
                                  observation: obs,
                                  department: obs.department as Department,
                                })}
                                onDelete={() => handleDeleteObservation(obs.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Sign-off bar */}
                  <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#f8fafc' }}>
                    <div>
                      {!isSignedOff && (
                        <button
                          onClick={() => setObsModal({ open: true, checklistItem: null, department: dept })}
                          className="btn-secondary text-xs py-1.5 px-3"
                        >
                          <Plus size={12} /> Log Observation
                        </button>
                      )}
                    </div>
                    {canSign ? (
                      <button
                        onClick={() => signOffPhase(activePhase, dept)}
                        className="btn-primary text-xs py-1.5 px-4"
                      >
                        <FileCheck size={14} /> Sign Off {dept}
                      </button>
                    ) : isSignedOff ? (
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}>
                        <Lock size={12} /> Signed off
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Phase observations summary */}
        <PhaseObservations
          observations={observations.filter(o => o.phase === activePhase)}
          onEdit={obs => setObsModal({ open: true, observation: obs, department: obs.department as Department })}
          onDelete={handleDeleteObservation}
        />
      </div>

      {obsModal.open && currentUser && stockTake && (
        <ObservationModal
          observation={obsModal.observation}
          checklistItem={obsModal.checklistItem}
          stockTakeId={stockTake.id}
          phase={activePhase}
          department={obsModal.department}
          userName={currentUser.name}
          userId={currentUser.id}
          onSave={handleSaveObservation}
          onClose={() => setObsModal({ open: false, department: 'Finance' })}
        />
      )}
    </AppShell>
  );
}

function ObservationCard({ observation, onEdit, onDelete }: { observation: ChecklistObservation; onEdit: () => void; onDelete: () => void }) {
  const statusColor = OBS_STATUS_COLORS[observation.status] || OBS_STATUS_COLORS.open;
  return (
    <div className="card p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium capitalize" style={{ background: statusColor.bg, color: statusColor.text }}>
          {observation.status.replace('_', ' ')}
        </span>
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--muted-light)' }}>
            {observation.reported_by} — {new Date(observation.reported_at).toLocaleDateString()}
          </span>
          <button onClick={onEdit} className="text-[var(--primary)] hover:underline text-[10px]">Edit</button>
          <button onClick={onDelete} className="text-[var(--error)] hover:underline text-[10px]">Delete</button>
        </div>
      </div>
      <div><strong className="text-[var(--muted)]">Issue:</strong> {observation.issue_description}</div>
      {observation.corrective_action && (
        <div className="flex items-start gap-1">
          <Shield size={10} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
          <span><strong className="text-[var(--muted)]">Corrective:</strong> {observation.corrective_action}</span>
        </div>
      )}
      {observation.preventive_action && (
        <div className="flex items-start gap-1">
          <Lightbulb size={10} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
          <span><strong className="text-[var(--muted)]">Preventive:</strong> {observation.preventive_action}</span>
        </div>
      )}
    </div>
  );
}

function PhaseObservations({ observations, onEdit, onDelete }: { observations: ChecklistObservation[]; onEdit: (obs: ChecklistObservation) => void; onDelete: (obsId: string) => void }) {
  if (observations.length === 0) return null;
  const open = observations.filter(o => o.status === 'open').length;
  const inProgress = observations.filter(o => o.status === 'in_progress').length;
  const closed = observations.filter(o => o.status === 'closed').length;

  return (
    <div className="card">
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--card-border-light)' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
          <h3 className="text-sm font-semibold">Observations</h3>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>({observations.length} total)</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {open > 0 && <span className="badge badge-red">{open} open</span>}
          {inProgress > 0 && <span className="badge badge-amber">{inProgress} in progress</span>}
          {closed > 0 && <span className="badge badge-green">{closed} closed</span>}
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--card-border-light)' }}>
        {observations.map(obs => (
          <div key={obs.id} className="px-4 py-3">
            <ObservationCard observation={obs} onEdit={() => onEdit(obs)} onDelete={() => onDelete(obs.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
