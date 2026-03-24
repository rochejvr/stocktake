'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { StockTakeClock } from '@/components/shared/StockTakeClock';
import { Package, Users, AlertTriangle, CheckCircle, ScanLine, Plus } from 'lucide-react';
import type { StockTake, StockTakeStats } from '@/types';
import Link from 'next/link';
import { format } from 'date-fns';

export default function OverviewPage() {
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [stats, setStats] = useState<StockTakeStats | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <AppShell stockTakeRef={stockTake?.reference} status={stockTake?.status}>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]" style={{ fontFamily: 'var(--font-display)' }}>
              {stockTake ? stockTake.name : 'Stock Take'}
            </h1>
            <p className="text-[var(--muted)] text-sm mt-1">
              {stockTake
                ? `${stockTake.reference} · Started ${stockTake.started_at ? format(new Date(stockTake.started_at), 'd MMM yyyy, HH:mm') : 'not yet'}`
                : 'No active stock take'}
            </p>
          </div>

          {!stockTake && (
            <Link href="/setup" className="btn-primary">
              <Plus size={16} />
              New Stock Take
            </Link>
          )}

          {stockTake && isCounting && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium"
              style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Counting in progress
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center h-64 text-[var(--muted)]">
            Loading…
          </div>
        )}

        {!loading && !stockTake && (
          <div className="card p-12 text-center">
            <Package size={48} className="mx-auto mb-4 text-[var(--muted-light)]" style={{ opacity: 0.3 }} />
            <h2 className="text-lg font-semibold mb-2">No active stock take</h2>
            <p className="text-[var(--muted)] text-sm mb-6">
              Create a new stock take to import Pastel inventory and begin the count process.
            </p>
            <Link href="/setup" className="btn-primary inline-flex">
              <Plus size={16} />
              Create Stock Take
            </Link>
          </div>
        )}

        {!loading && stockTake && (
          <div className="space-y-6">
            {/* Clock — only shown during active counting */}
            {isCounting && (
              <StockTakeClock
                countDeadline={stockTake.counting_deadline}
                recountDeadline={stockTake.recount_deadline}
                startedAt={stockTake.started_at}
              />
            )}

            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<Package size={20} />}
                  label="Parts in system"
                  value={stats.totalParts.toString()}
                  sub="from Pastel import"
                  color="blue"
                />
                <StatCard
                  icon={<ScanLine size={20} />}
                  label="Parts counted"
                  value={stats.countedParts.toString()}
                  sub={`of ${stats.totalParts}`}
                  color="green"
                />
                <StatCard
                  icon={<Users size={20} />}
                  label="Active counters"
                  value={stats.activeSessions.toString()}
                  sub={`${stats.submittedSessions} submitted`}
                  color="amber"
                />
                <StatCard
                  icon={<AlertTriangle size={20} />}
                  label="Flagged for recount"
                  value={stats.flaggedForRecount.toString()}
                  sub={stats.overallVariancePct != null ? `${stats.overallVariancePct.toFixed(1)}% overall variance` : 'pending'}
                  color={stats.flaggedForRecount > 0 ? 'red' : 'green'}
                />
              </div>
            )}

            {/* Status pipeline */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">Progress</h2>
              <StatusPipeline status={stockTake.status} />
            </div>

            {/* Quick actions */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">Quick Actions</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <QuickAction href="/checklist" label="Checklist" icon={<CheckCircle size={18} />} />
                <QuickAction href="/bom"       label="BOM Mapping" icon={<Package size={18} />} />
                <QuickAction href="/count"     label="Live Count" icon={<ScanLine size={18} />} />
                <QuickAction href="/reconcile" label="Reconcile" icon={<AlertTriangle size={18} />} />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: 'blue' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    blue:  { bg: 'var(--primary-light)',  fg: 'var(--primary)' },
    green: { bg: 'var(--success-light)',  fg: 'var(--success)' },
    amber: { bg: 'var(--accent-light)',   fg: 'var(--warning)' },
    red:   { bg: 'var(--error-light)',    fg: 'var(--error)' },
  };
  const c = colors[color];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: c.bg, color: c.fg }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}>
        {value}
      </div>
      <div className="text-xs text-[var(--muted)] mt-1">{sub}</div>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href}
      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-blue-50 transition-colors text-center group">
      <div className="text-[var(--muted)] group-hover:text-[var(--primary)] transition-colors">{icon}</div>
      <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
    </Link>
  );
}

const STAGES = ['setup', 'checklist', 'counting', 'recount', 'reviewing', 'complete'] as const;
const STAGE_LABELS: Record<string, string> = {
  setup: 'Setup', checklist: 'Checklist', counting: 'Counting',
  recount: 'Recount', reviewing: 'Reviewing', complete: 'Complete',
};

function StatusPipeline({ status }: { status: string }) {
  const currentIdx = STAGES.indexOf(status as typeof STAGES[number]);
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((stage, i) => {
        const done    = i < currentIdx;
        const active  = i === currentIdx;
        const pending = i > currentIdx;
        return (
          <div key={stage} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                done    ? 'bg-green-500 text-white' :
                active  ? 'bg-blue-600 text-white ring-4 ring-blue-100' :
                          'bg-slate-100 text-[var(--muted-light)]'
              }`}>
                {done ? '✓' : i + 1}
              </div>
              <div className={`text-[10px] mt-1.5 font-medium ${
                active ? 'text-blue-600' : done ? 'text-green-600' : 'text-[var(--muted-light)]'
              }`}>
                {STAGE_LABELS[stage]}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 mb-4 ${done ? 'bg-green-400' : 'bg-slate-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
