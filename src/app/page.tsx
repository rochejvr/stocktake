'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { StockTakeClock } from '@/components/shared/StockTakeClock';
import { ScanQRCard } from '@/components/shared/ScanQRCard';
import {
  Package, Users, AlertTriangle, CheckCircle, ScanLine, Plus,
  ClipboardList, GitBranch, ArrowRight, Calendar, Play,
} from 'lucide-react';
import type { StockTake, StockTakeStats } from '@/types';
import Link from 'next/link';
import { format } from 'date-fns';

const STAGES = ['setup', 'checklist', 'counting', 'recount', 'reviewing', 'complete'] as const;
const STAGE_LABELS: Record<string, string> = {
  setup: 'Setup', checklist: 'Checklist', counting: 'Counting',
  recount: 'Recount', reviewing: 'Review', complete: 'Complete',
};

const NEXT_STATUS: Record<string, { target: string; label: string; confirm: string }> = {
  setup:     { target: 'checklist', label: 'Move to Checklist', confirm: 'Advance to checklist phase?' },
  checklist: { target: 'counting',  label: 'Begin Count',       confirm: 'Start the count? Inventory will be frozen.' },
  counting:  { target: 'reviewing', label: 'End Counting',      confirm: 'End counting and move to review?' },
  recount:   { target: 'reviewing', label: 'End Recounts',      confirm: 'End recounts and move to review?' },
  reviewing: { target: 'complete',  label: 'Complete',           confirm: 'Mark this stock take as complete?' },
};

export default function OverviewPage() {
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [stats, setStats] = useState<StockTakeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    fetch('/api/stock-takes/active')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.stockTake) setStockTake(data.stockTake);
        if (data?.stats) setStats(data.stats);
      })
      .finally(() => setLoading(false));
  }, []);

  const isCounting = stockTake?.status === 'counting' || stockTake?.status === 'recount';
  const nextStep = stockTake ? NEXT_STATUS[stockTake.status] : null;

  const advanceStatus = async () => {
    if (!stockTake || !nextStep) return;
    if (!confirm(nextStep.confirm)) return;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/stock-takes/${stockTake.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStep.target }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to advance');
        return;
      }
      const updated = await res.json();
      setStockTake(updated);
    } catch {
      alert('Failed to advance status');
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <AppShell stockTakeRef={stockTake?.reference} status={stockTake?.status}>
      <div className="p-8 ">
        {loading && (
          <div className="flex items-center justify-center h-64 text-[var(--muted)]">
            <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && !stockTake && (
          <div className="fade-in">
            {/* Empty state hero */}
            <div className="card-elevated p-12 text-center">
              <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center" style={{ background: 'var(--primary-light)' }}>
                <Package size={28} style={{ color: 'var(--primary)' }} />
              </div>
              <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                No Active Stock Take
              </h1>
              <p className="text-[var(--muted)] text-sm mb-8 max-w-md mx-auto">
                Create a new stock take to import Pastel inventory, map your BOMs, and begin the quarterly count process.
              </p>
              <Link href="/setup" className="btn-primary inline-flex">
                <Plus size={16} />
                Create Stock Take
              </Link>
            </div>
          </div>
        )}

        {!loading && stockTake && (
          <div className="space-y-6 fade-in">
            {/* Hero header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                    {stockTake.name}
                  </h1>
                  {isCounting && (
                    <span className="badge badge-green flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-[var(--muted)]">
                  <span className="font-mono font-medium" style={{ color: 'var(--primary)' }}>
                    {stockTake.reference}
                  </span>
                  {stockTake.started_at && (
                    <span className="flex items-center gap-1.5">
                      <Calendar size={13} />
                      Started {format(new Date(stockTake.started_at), 'd MMM yyyy')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status pipeline + advance button */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <StatusPipeline status={stockTake.status} />
              </div>
              {nextStep && stockTake.status !== 'complete' && (
                <button
                  onClick={advanceStatus}
                  disabled={advancing}
                  className="flex-shrink-0 h-10 px-4 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  style={{ background: nextStep.target === 'counting' ? 'var(--success)' : 'var(--primary)' }}
                >
                  <Play size={14} />
                  {advancing ? 'Advancing...' : nextStep.label}
                </button>
              )}
            </div>

            {/* Clock */}
            {isCounting && (
              <StockTakeClock
                countDeadline={stockTake.counting_deadline}
                recountDeadline={stockTake.recount_deadline}
                startedAt={stockTake.started_at}
              />
            )}

            {/* QR code for counters */}
            {isCounting && <ScanQRCard />}

            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<Package size={18} />}
                  label="Unique Parts"
                  value={stats.totalParts.toString()}
                  sub="from Pastel import"
                  color="blue"
                />
                <StatCard
                  icon={<ScanLine size={18} />}
                  label="Parts Counted"
                  value={stats.countedParts.toString()}
                  sub={`of ${stats.totalParts}`}
                  color="green"
                />
                <StatCard
                  icon={<Users size={18} />}
                  label="Active Sessions"
                  value={stats.activeSessions.toString()}
                  sub={`${stats.submittedSessions} submitted`}
                  color="amber"
                />
                <StatCard
                  icon={<AlertTriangle size={18} />}
                  label="Flagged Recount"
                  value={stats.flaggedForRecount.toString()}
                  sub={stats.overallVariancePct != null ? `${stats.overallVariancePct.toFixed(1)}% variance` : 'pending'}
                  color={stats.flaggedForRecount > 0 ? 'red' : 'green'}
                />
              </div>
            )}

            {/* Quick actions */}
            <div>
              <h2 className="section-title mb-3">Quick Actions</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <QuickAction href="/checklist" label="Checklist" description="Pre-count sign-off" icon={<ClipboardList size={20} />} />
                <QuickAction href="/bom" label="BOM Mapping" description="WIP components" icon={<GitBranch size={20} />} />
                <QuickAction href="/count" label="Live Count" description="Scan feed" icon={<ScanLine size={20} />} />
                <QuickAction href="/reconcile" label="Reconcile" description="Variance analysis" icon={<CheckCircle size={20} />} />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
  color: 'blue' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className={`stat-card stat-card-${color}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: 'var(--font-display)' }}>
          {label}
        </span>
        <div className="text-[var(--muted-light)]">{icon}</div>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--muted)] mt-1">{sub}</div>
    </div>
  );
}

function QuickAction({ href, label, description, icon }: {
  href: string; label: string; description: string; icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="card card-interactive p-4 flex items-start gap-3 group">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--muted)] group-hover:text-[var(--primary)] transition-colors flex-shrink-0"
        style={{ background: 'var(--background)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold group-hover:text-[var(--primary)] transition-colors">{label}</div>
        <div className="text-[11px] text-[var(--muted)]">{description}</div>
      </div>
      <ArrowRight size={14} className="text-[var(--muted-light)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all mt-1" />
    </Link>
  );
}

function StatusPipeline({ status }: { status: string }) {
  const currentIdx = STAGES.indexOf(status as typeof STAGES[number]);
  return (
    <div className="card p-5">
      <div className="flex items-center">
        {STAGES.map((stage, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={stage} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done   ? 'bg-green-500 text-white' :
                  active ? 'bg-[var(--primary)] text-white ring-4 ring-blue-100' :
                           'bg-slate-100 text-[var(--muted-light)]'
                }`}>
                  {done ? <CheckCircle size={14} /> : i + 1}
                </div>
                <div className={`text-[10px] mt-2 font-semibold tracking-wide ${
                  active ? 'text-[var(--primary)]' : done ? 'text-green-600' : 'text-[var(--muted-light)]'
                }`} style={{ fontFamily: 'var(--font-display)' }}>
                  {STAGE_LABELS[stage]}
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 mb-5 rounded-full ${done ? 'bg-green-400' : 'bg-slate-100'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
