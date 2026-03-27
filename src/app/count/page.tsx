'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import {
  ScanLine, Users, Package, RefreshCw, Clock, CheckCircle, UserPlus, Trash2, Eye, EyeOff, StopCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ScanQRCard } from '@/components/shared/ScanQRCard';
import type { StockTake, StockTakeStats, Counter } from '@/types';
import { formatDistanceToNow } from 'date-fns';

interface SessionRow {
  id: string;
  user_name: string;
  count_number: number;
  zone: string | null;
  started_at: string;
  submitted_at: string | null;
  record_count: number;
}

export default function CountPage() {
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [stats, setStats] = useState<StockTakeStats | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newCounterName, setNewCounterName] = useState('');
  const [newCounterZone, setNewCounterZone] = useState('');
  const [addingCounter, setAddingCounter] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [visiblePins, setVisiblePins] = useState<Set<string>>(new Set());
  const [endingCount, setEndingCount] = useState(false);
  const [endCountError, setEndCountError] = useState<string | null>(null);
  const router = useRouter();

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const stRes = await fetch('/api/stock-takes/active');
      const stData = await stRes.json();
      const st: StockTake | null = stData?.stockTake ?? null;
      setStockTake(st);
      setStats(stData?.stats ?? null);

      if (st) {
        const [sessRes, countRes] = await Promise.all([
          fetch(`/api/scan-sessions?stockTakeId=${st.id}`),
          fetch(`/api/counters?stockTakeId=${st.id}`),
        ]);
        const sessData = await sessRes.json();
        setSessions(Array.isArray(sessData) ? sessData : []);
        const countData = await countRes.json();
        setCounters(Array.isArray(countData) ? countData : []);
      }
    } catch { /* ignore */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const activeSessions = sessions.filter(s => !s.submitted_at);
  const submittedSessions = sessions.filter(s => s.submitted_at);
  const totalScans = sessions.reduce((sum, s) => sum + s.record_count, 0);
  const isCounting = stockTake?.status === 'counting' || stockTake?.status === 'recount';

  const handleAddCounter = async () => {
    if (!stockTake || !newCounterName.trim()) return;
    setAddingCounter(true);
    setCounterError(null);
    try {
      const res = await fetch('/api/counters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_take_id: stockTake.id,
          name: newCounterName.trim(),
          zone: newCounterZone.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add counter');
      setCounters(prev => [...prev, data]);
      setNewCounterName('');
      setNewCounterZone('');
      // Auto-show PIN for the newly created counter
      setVisiblePins(prev => new Set(prev).add(data.id));
    } catch (e) {
      setCounterError(e instanceof Error ? e.message : 'Failed to add counter');
    } finally {
      setAddingCounter(false);
    }
  };

  const handleDeleteCounter = async (id: string, name: string) => {
    if (!confirm(`Remove counter "${name}"?`)) return;
    try {
      await fetch(`/api/counters/${id}`, { method: 'DELETE' });
      setCounters(prev => prev.filter(c => c.id !== id));
    } catch { /* ignore */ }
  };

  const handleEndCounting = async () => {
    if (!stockTake) return;
    const activeCount = activeSessions.length;
    const msg = activeCount > 0
      ? `There are still ${activeCount} active (unsubmitted) session(s). End counting anyway? This will aggregate all scan records into count results.`
      : 'End counting and generate count results? This will compare scanned quantities against Pastel.';
    if (!confirm(msg)) return;

    setEndingCount(true);
    setEndCountError(null);
    try {
      const res = await fetch(`/api/stock-takes/${stockTake.id}/end-counting`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to end counting');
      // Navigate to reconcile page
      router.push('/reconcile');
    } catch (e) {
      setEndCountError(e instanceof Error ? e.message : 'Failed to end counting');
    } finally {
      setEndingCount(false);
    }
  };

  const togglePinVisibility = (id: string) => {
    setVisiblePins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AppShell>
      <div className="p-8">
        {loading && (
          <div className="flex items-center justify-center h-64 text-[var(--muted)]">
            <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && (!stockTake || !isCounting) && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-[var(--muted)]">
              <ScanLine size={32} className="mx-auto mb-3 opacity-30" />
              <div className="font-medium text-[var(--foreground)]">Live Count</div>
              <div className="text-sm mt-1">
                {stockTake
                  ? 'Stock take is not in counting mode'
                  : 'No active stock take'}
              </div>
            </div>
          </div>
        )}

        {!loading && stockTake && isCounting && (
          <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                  Live Count
                </h1>
                <p className="text-sm text-[var(--muted)]">
                  Real-time scanning activity · auto-refreshes every 30s
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchData(true)}
                  disabled={refreshing}
                  className="h-9 px-3 rounded-lg border text-sm font-medium flex items-center gap-1.5 transition-colors hover:bg-slate-50"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                  Refresh
                </button>
                <button
                  onClick={handleEndCounting}
                  disabled={endingCount}
                  className="h-9 px-4 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  style={{ background: 'var(--error)' }}
                >
                  <StopCircle size={14} />
                  {endingCount ? 'Processing...' : 'End Counting'}
                </button>
              </div>
            </div>

            {endCountError && (
              <div className="text-sm text-[var(--error)] bg-[var(--error-light)] px-4 py-2.5 rounded-lg">
                {endCountError}
              </div>
            )}

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MiniStat icon={<Users size={18} />} label="Active Counters" value={activeSessions.length} color="blue" />
              <MiniStat icon={<CheckCircle size={18} />} label="Submitted" value={submittedSessions.length} color="green" />
              <MiniStat icon={<ScanLine size={18} />} label="Total Scans" value={totalScans} color="amber" />
              <MiniStat icon={<Package size={18} />} label="Parts in System" value={stats?.totalParts ?? 0} color="muted" />
            </div>

            {/* Scanner QR code */}
            <ScanQRCard compact />

            {/* Active sessions */}
            <div>
              <h2 className="section-title mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Active Sessions ({activeSessions.length})
              </h2>
              {activeSessions.length === 0 ? (
                <div className="card p-6 text-center text-sm text-[var(--muted)]">
                  No active scanning sessions
                </div>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map(s => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              )}
            </div>

            {/* Submitted sessions */}
            {submittedSessions.length > 0 && (
              <div>
                <h2 className="section-title mb-3">
                  Submitted Sessions ({submittedSessions.length})
                </h2>
                <div className="space-y-2">
                  {submittedSessions.map(s => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </div>
            )}

            {/* Registered Counters */}
            <div>
              <h2 className="section-title mb-3 flex items-center gap-2">
                <UserPlus size={16} />
                Registered Counters ({counters.length})
              </h2>

              {/* Add counter form */}
              <div className="card p-4 mb-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-[var(--muted)] mb-1 uppercase tracking-wider">Name</label>
                    <input
                      type="text"
                      value={newCounterName}
                      onChange={e => setNewCounterName(e.target.value)}
                      placeholder="Counter name"
                      className="w-full h-9 px-3 rounded-md border text-sm bg-white"
                      style={{ borderColor: 'var(--card-border)' }}
                      onKeyDown={e => { if (e.key === 'Enter' && newCounterName.trim()) handleAddCounter(); }}
                    />
                  </div>
                  <div className="w-32">
                    <label className="block text-[10px] font-semibold text-[var(--muted)] mb-1 uppercase tracking-wider">Zone</label>
                    <input
                      type="text"
                      value={newCounterZone}
                      onChange={e => setNewCounterZone(e.target.value)}
                      placeholder="Optional"
                      className="w-full h-9 px-3 rounded-md border text-sm bg-white"
                      style={{ borderColor: 'var(--card-border)' }}
                    />
                  </div>
                  <button
                    onClick={handleAddCounter}
                    disabled={!newCounterName.trim() || addingCounter}
                    className="h-9 px-4 rounded-md text-white text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: 'var(--primary)' }}
                  >
                    {addingCounter ? '...' : 'Add'}
                  </button>
                </div>
                {counterError && (
                  <div className="text-xs text-[var(--error)] mt-2">{counterError}</div>
                )}
              </div>

              {/* Counter list */}
              {counters.length === 0 ? (
                <div className="card p-6 text-center text-sm text-[var(--muted)]">
                  No counters registered yet. Add counters above — each gets a unique 4-digit PIN.
                </div>
              ) : (
                <div className="space-y-2">
                  {counters.map(c => (
                    <div key={c.id} className="card px-4 py-3 flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-blue-500">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{c.name}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {c.zone ? `Zone: ${c.zone}` : 'No zone assigned'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="font-mono text-sm font-bold tracking-wider min-w-[3.5rem] text-center"
                          style={{ fontFamily: 'var(--font-display)' }}>
                          {visiblePins.has(c.id) ? c.pin : '****'}
                        </div>
                        <button
                          onClick={() => togglePinVisibility(c.id)}
                          className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                        >
                          {visiblePins.has(c.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          onClick={() => handleDeleteCounter(c.id, c.name)}
                          className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function MiniStat({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string;
}) {
  return (
    <div className={`stat-card stat-card-${color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]"
          style={{ fontFamily: 'var(--font-display)' }}>
          {label}
        </span>
        <div className="text-[var(--muted-light)]">{icon}</div>
      </div>
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
    </div>
  );
}

function SessionCard({ session }: { session: SessionRow }) {
  const isActive = !session.submitted_at;
  return (
    <div className="card px-4 py-3 flex items-center gap-4">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
        isActive ? 'bg-green-500' : 'bg-slate-400'
      }`}>
        {session.user_name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{session.user_name}</div>
        <div className="text-[11px] text-[var(--muted)]">
          Count {session.count_number}
          {session.zone ? ` · ${session.zone}` : ''}
          {' · '}
          {formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {session.record_count}
        </div>
        <div className="text-[10px] text-[var(--muted)]">scans</div>
      </div>
      {isActive ? (
        <Clock size={14} className="text-green-500 flex-shrink-0" />
      ) : (
        <CheckCircle size={14} className="text-slate-400 flex-shrink-0" />
      )}
    </div>
  );
}
