'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Filter,
  Search, ArrowUpDown, CheckCircle, XCircle, Flag, Printer, ListChecks,
  EyeOff, Eye, RotateCcw, Calculator,
} from 'lucide-react';
import type { StockTake, CountResult } from '@/types';
import { STORE_LABELS, TIER_LABELS, RECOUNT_THRESHOLDS, RECOUNT_ZAR_THRESHOLD } from '@/lib/constants';

type FilterType = 'all' | 'flagged' | 'variance' | 'uncounted' | 'accepted';
type SortField = 'part_number' | 'variance_pct' | 'variance_qty' | 'tier' | 'pastel_qty';
type SortDir = 'asc' | 'desc';

type CounterEntry = { counter: string; direct: number; wip: number; ext: number; total: number };
type CounterBreakdown = { count1: CounterEntry[]; count2: CounterEntry[] };

// Prefer C2 only when its variance (|c2 - pastel|) is lower than C1's variance.
// A recount that's "closer to Pastel" is assumed to be the more accurate physical count.
function shouldPreferCount2(r: { count1_qty: number | null; count2_qty: number | null; pastel_qty: number }): boolean {
  if (r.count2_qty === null || r.count1_qty === null) return false;
  const c1Var = Math.abs(r.count1_qty - r.pastel_qty);
  const c2Var = Math.abs(r.count2_qty - r.pastel_qty);
  return c2Var < c1Var;
}

// Round to 1 decimal; drop the decimal if the value is a whole number.
function formatNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

const EXCLUDED_DEVIATION_KEY = (stockTakeId: string) => `deviation-excluded-${stockTakeId}`;
function loadExcludedIds(stockTakeId: string): Set<string> {
  try {
    const raw = localStorage.getItem(EXCLUDED_DEVIATION_KEY(stockTakeId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}
function saveExcludedIds(stockTakeId: string, ids: Set<string>) {
  try { localStorage.setItem(EXCLUDED_DEVIATION_KEY(stockTakeId), JSON.stringify([...ids])); } catch { /* noop */ }
}

export default function ReconcilePage() {
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [results, setResults] = useState<CountResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [storeFilter, setStoreFilter] = useState<'all' | '001' | '002'>('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('part_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [hideZeroZero, setHideZeroZero] = useState(true);
  const [showRecountList, setShowRecountList] = useState(false);
  const [recountParts, setRecountParts] = useState<Array<CountResult & { is_chain_parent?: boolean }>>([]);
  const [recountWips, setRecountWips] = useState<Array<{ part_number: string; description: string; store_code: string; pastel_qty: number; count1_qty: number | null; count2_qty: number | null }>>([]);
  const [recountSelection, setRecountSelection] = useState<Set<string>>(new Set());
  const [loadingRecount, setLoadingRecount] = useState(false);
  // Per-row count selection: which count to show (1 or 2). Only rows with count2 can be toggled.
  const [count2Rows, setCount2Rows] = useState<Set<string>>(new Set());
  // Per-counter breakdown for expanded rows (fetched on-demand)
  const [breakdowns, setBreakdowns] = useState<Record<string, CounterBreakdown>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<string | null>(null);
  // IDs excluded from deviation calc (user can toggle per row; does NOT affect export)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const stRes = await fetch('/api/stock-takes/active');
      const stData = await stRes.json();
      const st: StockTake | null = stData?.stockTake ?? null;
      setStockTake(st);

      if (st) {
        // Load excluded IDs for this stock take from localStorage
        setExcludedIds(loadExcludedIds(st.id));
        // Always fetch all results — filter client-side for instant tab switching
        const crRes = await fetch(`/api/count-results?stockTakeId=${st.id}&filter=all`);
        const crData = await crRes.json();
        const arr: CountResult[] = Array.isArray(crData) ? crData : [];
        setResults(arr);
        // Pre-populate C1/C2 toggle: default to C2 when recount variance is smaller
        // (closer to Pastel = more accurate physical count). User can toggle manually.
        const autoC2 = new Set<string>();
        for (const r of arr) {
          if (shouldPreferCount2(r)) autoC2.add(r.id);
        }
        setCount2Rows(autoC2);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-accept zero-variance items on data load (only in reviewing status)
  useEffect(() => {
    if (stockTake?.status !== 'reviewing') return;
    const pickActive = (r: CountResult) => {
      return shouldPreferCount2(r) ? r.count2_qty : r.count1_qty;
    };
    const toAutoAccept = results.filter(r => {
      if (r.deviation_accepted === true) return false;
      const counted = pickActive(r);
      if (counted === null) return false;
      const varQty = counted - r.pastel_qty;
      const varPct = r.pastel_qty !== 0 ? Math.abs((varQty / r.pastel_qty) * 100) : (counted !== 0 ? 100 : 0);
      const tier = (r.tier || 'C') as 'A' | 'B' | 'C';
      const threshold = RECOUNT_THRESHOLDS[tier];
      // Within tier % tolerance
      if (varPct > threshold) return false;
      // Also check absolute ZAR threshold if unit_cost is known
      if (r.unit_cost && Math.abs(varQty) * Number(r.unit_cost) > RECOUNT_ZAR_THRESHOLD) return false;
      return true;
    });
    if (toAutoAccept.length === 0) return;

    // Fire-and-forget batch auto-accept
    (async () => {
      for (const item of toAutoAccept) {
        const activeQty = pickActive(item)!;
        try {
          const res = await fetch(`/api/count-results/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviation_accepted: true,
              accepted_qty: activeQty,
              accepted_by: 'auto',
              accepted_at: new Date().toISOString(),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setResults(prev => prev.map(r => r.id === item.id ? data : r));
          }
        } catch { /* ignore */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockTake?.status, results.length]);

  // Fetch per-counter breakdown when a row is expanded
  useEffect(() => {
    if (!expandedId || breakdowns[expandedId]) return;
    setLoadingBreakdown(expandedId);
    fetch(`/api/count-results/${expandedId}/breakdown`)
      .then(r => r.json())
      .then(data => {
        if (data.count1 || data.count2) {
          setBreakdowns(prev => ({ ...prev, [expandedId]: data }));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingBreakdown(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId]);

  // Count how many zero/zero items are hidden
  const zeroZeroCount = useMemo(() =>
    results.filter(r => r.pastel_qty === 0 && (r.count1_qty === null || r.count1_qty === 0)).length,
    [results]
  );

  // Filter by tab + store + search + zero/zero (all client-side)
  const filtered = results.filter(r => {
    // Tab filter
    if (filter === 'flagged' && !r.recount_flagged) return false;
    if (filter === 'variance' && (r.variance_qty === 0 || r.variance_qty === null)) return false;
    if (filter === 'uncounted' && r.count1_qty !== null) return false;
    if (filter === 'accepted' && r.deviation_accepted !== true) return false;
    // Store filter
    if (storeFilter !== 'all' && r.store_code !== storeFilter) return false;
    // Zero/zero filter
    if (hideZeroZero && r.pastel_qty === 0 && (r.count1_qty === null || r.count1_qty === 0)) return false;
    // Search
    if (!search) return true;
    const s = search.toLowerCase();
    return r.part_number.toLowerCase().includes(s) || r.description.toLowerCase().includes(s);
  });

  // Sort — primary: part_number + store_code (stable). Secondary: chosen sort field.
  const sorted = [...filtered].sort((a, b) => {
    // Primary: part number ascending, then store_code (001 Main before 002 Quarantine)
    const pnCmp = a.part_number.localeCompare(b.part_number);
    if (sortField === 'part_number') {
      if (pnCmp !== 0) return sortDir === 'asc' ? pnCmp : -pnCmp;
      return a.store_code.localeCompare(b.store_code);
    }
    // Other sort fields: use as primary, then part_number + store as tiebreaker
    let av: number | string, bv: number | string;
    switch (sortField) {
      case 'variance_pct': av = Math.abs(getActiveVariancePct(a, count2Rows)); bv = Math.abs(getActiveVariancePct(b, count2Rows)); break;
      case 'variance_qty': av = Math.abs(getActiveVarianceQty(a, count2Rows)); bv = Math.abs(getActiveVarianceQty(b, count2Rows)); break;
      case 'tier': av = a.tier; bv = b.tier; break;
      case 'pastel_qty': av = a.pastel_qty; bv = b.pastel_qty; break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    // Tiebreaker: part_number + store_code
    if (pnCmp !== 0) return pnCmp;
    return a.store_code.localeCompare(b.store_code);
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Stats
  const totalParts = results.length;
  const flaggedParts = results.filter(r => r.recount_flagged).length;
  const uncountedParts = results.filter(r => r.count1_qty === null).length;
  const acceptedParts = results.filter(r => r.deviation_accepted === true).length;
  const anyHasCount2 = results.some(r => r.count2_qty !== null);

  // Overall deviation: sum(abs(variance)) / sum(counted qty) across all counted items
  const deviationStats = useMemo(() => {
    let totalCounted = 0;
    let totalPastel = 0;        // stable baseline — all inventory, regardless of count state
    let totalAbsVariance = 0;
    let totalValueVariance = 0;
    let countedParts = 0;
    let excludedFromCalc = 0;
    for (const r of results) {
      if (excludedIds.has(r.id)) {
        excludedFromCalc++;
        continue; // excluded from BOTH numerator and denominator
      }
      totalPastel += r.pastel_qty;
      // Pick active count: accepted first, then c2 if recount variance is smaller, else c1
      const counted = r.accepted_qty ?? (shouldPreferCount2(r) ? r.count2_qty : r.count1_qty);
      if (counted === null) continue;
      countedParts++;
      totalCounted += counted;
      const variance = counted - r.pastel_qty;
      totalAbsVariance += Math.abs(variance);
      if (r.unit_cost) totalValueVariance += Math.abs(variance) * Number(r.unit_cost);
    }
    // Deviation as % of expected stock (Pastel inventory) — stable between counts
    const overallPct = totalPastel > 0 ? (totalAbsVariance / totalPastel) * 100 : 0;
    return { totalCounted, totalPastel, totalAbsVariance, totalValueVariance, overallPct, countedParts, excludedFromCalc };
  }, [results, excludedIds]);

  // Accept deviation — uses the active count qty
  const handleAcceptDeviation = async (id: string, acceptedQty: number) => {
    setAccepting(id);
    try {
      const res = await fetch(`/api/count-results/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviation_accepted: true,
          accepted_qty: acceptedQty,
          accepted_by: 'supervisor',
          accepted_at: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(prev => prev.map(r => r.id === id ? data : r));
    } catch { /* ignore */ }
    finally { setAccepting(null); }
  };

  // Un-accept a previously accepted line item
  const handleUnaccept = async (id: string) => {
    setAccepting(id);
    try {
      const res = await fetch(`/api/count-results/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviation_accepted: null,
          accepted_qty: null,
          accepted_by: null,
          accepted_at: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(prev => prev.map(r => r.id === id ? data : r));
    } catch { /* ignore */ }
    finally { setAccepting(null); }
  };

  // Manual flag for recount
  const handleToggleFlag = async (id: string, currentlyFlagged: boolean) => {
    try {
      const reasons = currentlyFlagged ? [] : ['manual_supervisor_flag'];
      const res = await fetch(`/api/count-results/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recount_flagged: !currentlyFlagged,
          recount_reasons: reasons,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(prev => prev.map(r => r.id === id ? data : r));
    } catch { /* ignore */ }
  };

  // Toggle per-row count version
  const handleToggleCountVersion = (id: string) => {
    setCount2Rows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Toggle per-row exclusion from deviation calc (persisted in localStorage)
  const handleToggleExclude = (id: string) => {
    if (!stockTake) return;
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveExcludedIds(stockTake.id, next);
      return next;
    });
  };

  const isReviewable = stockTake?.status === 'reviewing' || stockTake?.status === 'recount';
  const isRecount = stockTake?.status === 'recount';
  const [reopening, setReopening] = useState(false);

  // Reopen counting — set status back to recount so counters can scan again
  const handleReopenCounting = async () => {
    if (!stockTake) return;
    if (!confirm('Reopen counting? This will set the stock take back to recount mode so counters can scan flagged items again. Only rescanned items will be updated — items not rescanned keep their existing Count 2 data.')) return;
    setReopening(true);
    try {
      const res = await fetch(`/api/stock-takes/${stockTake.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'recount' }),
      });
      if (res.ok) {
        fetchData(); // refresh to pick up new status
      }
    } catch { /* ignore */ }
    finally { setReopening(false); }
  };

  const handleLoadRecountList = async () => {
    if (!stockTake) return;
    setLoadingRecount(true);
    try {
      const res = await fetch(`/api/count-results/recount-list?stockTakeId=${stockTake.id}`);
      const data = await res.json();
      if (data.parts) {
        setRecountParts(data.parts);
        setRecountWips(data.wips || []);
        // Select all parts by default, WIPs use wip_code|store as ID
        const allIds = new Set([
          ...data.parts.map((r: CountResult) => r.id),
          ...((data.wips || []) as Array<{ part_number: string; store_code: string }>).map((w) => `wip_${w.part_number}|${w.store_code}`),
        ]);
        setRecountSelection(allIds);
        setShowRecountList(true);
      }
    } catch { /* ignore */ }
    finally { setLoadingRecount(false); }
  };

  const handleToggleRecountItem = (id: string) => {
    setRecountSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allRecountIds = [
    ...recountParts.map(r => r.id),
    ...recountWips.map(w => `wip_${w.part_number}|${w.store_code}`),
  ];

  const handleSelectAllRecount = (selectAll: boolean) => {
    setRecountSelection(selectAll ? new Set(allRecountIds) : new Set());
  };

  const handleSaveRecountSelection = async () => {
    if (!stockTake) return;
    for (const item of recountParts) {
      const shouldFlag = recountSelection.has(item.id);
      if (shouldFlag !== item.recount_flagged) {
        await fetch(`/api/count-results/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recount_flagged: shouldFlag,
            recount_reasons: shouldFlag ? item.recount_reasons : [],
          }),
        });
      }
    }
    fetchData();
    setShowRecountList(false);
  };

  const handlePrintRecountList = () => {
    const selectedParts = recountParts.filter(r => recountSelection.has(r.id));
    const selectedWips = recountWips.filter(w => recountSelection.has(`wip_${w.part_number}|${w.store_code}`));
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const td = 'padding:4px 8px;border:1px solid #ddd';
    const partRows = selectedParts.map(item => {
      const lastCount = item.count2_qty ?? item.count1_qty;
      return `<tr>
        <td style="${td};font-family:monospace">${item.part_number}</td>
        <td style="${td}">${item.description}</td>
        <td style="${td}">${STORE_LABELS[item.store_code] || item.store_code}</td>
        <td style="${td};text-align:right">${lastCount ?? '—'}</td>
        <td style="${td}"></td>
      </tr>`;
    }).join('');

    const wipRows = selectedWips.map(w => {
      const lastCount = w.count2_qty ?? w.count1_qty;
      return `<tr>
        <td style="${td};font-family:monospace">${w.part_number}</td>
        <td style="${td}">${w.description || ''}</td>
        <td style="${td}">${STORE_LABELS[w.store_code] || w.store_code}</td>
        <td style="${td};text-align:right">${lastCount ?? '—'}</td>
        <td style="${td}"></td>
      </tr>`;
    }).join('');

    const tableHead = `<thead><tr>
      <th>Code</th><th>Description</th><th>Store</th>
      <th style="text-align:right">Last Count</th><th>New Count</th>
    </tr></thead>`;

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Recount List — ${stockTake?.reference}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-bottom:24px}th{background:#f5f5f5;padding:6px 8px;border:1px solid #ddd;text-align:left;font-size:11px;text-transform:uppercase}td{font-size:12px;vertical-align:top}h3{margin:16px 0 4px;color:#333}@media print{body{padding:0}}</style>
    </head><body>
      <h2 style="margin-bottom:4px">Recount List</h2>
      <p style="color:#666;margin-top:0">${stockTake?.reference} — ${new Date().toLocaleDateString()}</p>
      <h3>Parts (${selectedParts.length})</h3>
      <table>${tableHead}<tbody>${partRows}</tbody></table>
      ${selectedWips.length > 0 ? `<h3>WIPs (${selectedWips.length})</h3><table>${tableHead}<tbody>${wipRows}</tbody></table>` : ''}
    </body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <>
      <div className="p-8">
        {loading && (
          <div className="flex items-center justify-center h-64 text-[var(--muted)]">
            <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-[var(--muted)]">
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
              <div className="font-medium text-[var(--foreground)]">Reconcile</div>
              <div className="text-sm mt-1">
                {!stockTake
                  ? 'No active stock take'
                  : stockTake.status === 'counting'
                  ? 'Counting still in progress — end counting first'
                  : 'No count results available yet'}
              </div>
            </div>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                  Reconciliation
                </h1>
                <p className="text-sm text-[var(--muted)]">
                  Variance analysis — {stockTake?.reference}
                  {isRecount && <span className="ml-2 text-amber-600 font-semibold">· Recount mode</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {stockTake?.status === 'reviewing' && (
                  <button
                    onClick={handleReopenCounting}
                    disabled={reopening}
                    className="h-9 px-4 rounded-lg border text-sm font-semibold flex items-center gap-1.5 transition-colors hover:bg-orange-50 cursor-pointer disabled:opacity-50"
                    style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                  >
                    <RotateCcw size={14} />
                    {reopening ? 'Reopening...' : 'Reopen Counting'}
                  </button>
                )}
                {flaggedParts > 0 && (
                  <button
                    onClick={handleLoadRecountList}
                    disabled={loadingRecount}
                    className="h-9 px-4 rounded-lg border text-sm font-semibold flex items-center gap-1.5 transition-colors hover:bg-amber-50 cursor-pointer"
                    style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                  >
                    <ListChecks size={14} />
                    {loadingRecount ? 'Loading...' : `Recount List (${flaggedParts})`}
                  </button>
                )}
              </div>
            </div>

            {/* Recount list panel */}
            {showRecountList && (
              <div className="card p-5 border-2" style={{ borderColor: 'var(--warning)' }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                      Recount List
                    </h2>
                    <p className="text-xs text-[var(--muted)]">
                      {recountSelection.size} of {allRecountIds.length} items selected for recount
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectAllRecount(recountSelection.size < allRecountIds.length)}
                      className="text-xs text-[var(--primary)] font-medium hover:underline"
                    >
                      {recountSelection.size === allRecountIds.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={handlePrintRecountList}
                      disabled={recountSelection.size === 0}
                      className="h-8 px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors hover:bg-slate-50 cursor-pointer disabled:opacity-40"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      <Printer size={12} />
                      Print
                    </button>
                    <button
                      onClick={handleSaveRecountSelection}
                      className="h-8 px-3 rounded-md text-white text-xs font-semibold cursor-pointer"
                      style={{ background: 'var(--primary)' }}
                    >
                      Save & Close
                    </button>
                    <button
                      onClick={() => setShowRecountList(false)}
                      className="text-[var(--muted)] hover:text-[var(--foreground)] p-1"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {/* Parts section */}
                  <div className="px-4 py-1.5 bg-slate-50 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider border-b" style={{ borderColor: 'var(--card-border)' }}>
                    Parts ({recountParts.length})
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                        <th className="text-center px-2 py-2 w-8"></th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Part Number</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Description</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Store</th>
                        <th className="text-right px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Last Count</th>
                        <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recountParts.map(item => (
                        <tr
                          key={item.id}
                          className="border-b hover:bg-slate-50 transition-colors"
                          style={{ borderColor: 'var(--card-border)', opacity: recountSelection.has(item.id) ? 1 : 0.4 }}
                        >
                          <td className="text-center px-2 py-2">
                            <input type="checkbox" checked={recountSelection.has(item.id)}
                              onChange={() => handleToggleRecountItem(item.id)} className="cursor-pointer" />
                          </td>
                          <td className="px-2 py-2 font-mono font-medium">{item.part_number}</td>
                          <td className="px-2 py-2 text-[var(--muted)]">{item.description}</td>
                          <td className="px-2 py-2 text-[var(--muted)]">{STORE_LABELS[item.store_code] || item.store_code}</td>
                          <td className="px-2 py-2 text-right font-mono">{item.count2_qty ?? item.count1_qty ?? '—'}</td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap gap-1">
                              {item.is_chain_parent && (
                                <span className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">Chain parent</span>
                              )}
                              {item.recount_reasons?.map((r: string) => (
                                <span key={r} className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">
                                  {REASON_LABELS[r]?.split(' ').slice(0, 3).join(' ') || r}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* WIPs section */}
                  {recountWips.length > 0 && (
                    <>
                      <div className="px-4 py-1.5 bg-slate-50 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider border-b border-t" style={{ borderColor: 'var(--card-border)' }}>
                        WIPs ({recountWips.length})
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                            <th className="text-center px-2 py-2 w-8"></th>
                            <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">WIP Code</th>
                            <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Description</th>
                            <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Store</th>
                            <th className="text-right px-2 py-2 text-[10px] font-semibold text-[var(--muted)] uppercase">Last Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recountWips.map(w => {
                            const wipId = `wip_${w.part_number}|${w.store_code}`;
                            return (
                              <tr
                                key={wipId}
                                className="border-b hover:bg-slate-50 transition-colors"
                                style={{ borderColor: 'var(--card-border)', opacity: recountSelection.has(wipId) ? 1 : 0.4 }}
                              >
                                <td className="text-center px-2 py-2">
                                  <input type="checkbox" checked={recountSelection.has(wipId)}
                                    onChange={() => handleToggleRecountItem(wipId)} className="cursor-pointer" />
                                </td>
                                <td className="px-2 py-2 font-mono font-medium">{w.part_number}</td>
                                <td className="px-2 py-2 text-[var(--muted)]">{w.description || ''}</td>
                                <td className="px-2 py-2 text-[var(--muted)]">{STORE_LABELS[w.store_code] || w.store_code}</td>
                                <td className="px-2 py-2 text-right font-mono">{w.count2_qty ?? w.count1_qty ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Summary stats */}
            <div className="card p-0 overflow-hidden">
              <div className="flex flex-col md:flex-row">
                {/* Hero: Overall deviation */}
                <div className="flex-shrink-0 px-6 py-5 flex items-center gap-5 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--card-border)' }}>
                  <div className="relative w-20 h-20">
                    <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--card-border)" strokeWidth="2.5" />
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke={deviationStats.overallPct <= 3 ? '#22c55e' : deviationStats.overallPct <= 10 ? 'var(--warning)' : 'var(--error)'}
                        strokeWidth="2.5"
                        strokeDasharray={`${Math.min(100, 100 - deviationStats.overallPct)} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-bold" style={{
                        fontFamily: 'var(--font-display)',
                        color: deviationStats.overallPct <= 3 ? '#22c55e' : deviationStats.overallPct <= 10 ? 'var(--warning)' : 'var(--error)',
                      }}>
                        {deviationStats.overallPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>Overall Deviation</div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">
                      {formatNum(deviationStats.totalAbsVariance)} variance / {formatNum(deviationStats.totalPastel)} Pastel inventory
                      {deviationStats.excludedFromCalc > 0 && <span> · {deviationStats.excludedFromCalc} excluded</span>}
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {deviationStats.countedParts.toLocaleString()} of {totalParts.toLocaleString()} parts counted
                    </div>
                    {deviationStats.totalValueVariance > 0 && (
                      <div className="text-[11px] text-[var(--muted)]">
                        R{deviationStats.totalValueVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} value variance
                      </div>
                    )}
                  </div>
                </div>
                {/* Secondary stats */}
                <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 divide-x" style={{ '--tw-divide-opacity': '1', borderColor: 'var(--card-border)' } as React.CSSProperties}>
                  <div className="px-4 py-4 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Total Parts</div>
                    <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)' }}>{totalParts}</div>
                  </div>
                  <div className="px-4 py-4 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Flagged</div>
                    <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)', color: flaggedParts > 0 ? 'var(--warning)' : 'var(--foreground)' }}>{flaggedParts}</div>
                  </div>
                  <div className="px-4 py-4 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Accepted</div>
                    <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)', color: acceptedParts > 0 ? '#22c55e' : 'var(--foreground)' }}>{acceptedParts}</div>
                  </div>
                  <div className="px-4 py-4 flex flex-col items-center justify-center">
                    <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Remaining</div>
                    <div className="text-2xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)', color: (totalParts - acceptedParts - uncountedParts) > 0 ? 'var(--foreground)' : '#22c55e' }}>
                      {totalParts - acceptedParts - uncountedParts}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters + Search */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 bg-white rounded-lg border p-1" style={{ borderColor: 'var(--card-border)' }}>
                <Filter size={14} className="text-[var(--muted)] ml-2" />
                {(['all', 'flagged', 'variance', 'uncounted', 'accepted'] as FilterType[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize"
                    style={{
                      background: filter === f ? 'var(--primary-light)' : 'transparent',
                      color: filter === f ? 'var(--primary)' : 'var(--muted)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-white rounded-lg border p-1" style={{ borderColor: 'var(--card-border)' }}>
                {(['all', '001', '002'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStoreFilter(s)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                    style={{
                      background: storeFilter === s ? 'var(--primary-light)' : 'transparent',
                      color: storeFilter === s ? 'var(--primary)' : 'var(--muted)',
                    }}
                  >
                    {s === 'all' ? 'All Stores' : STORE_LABELS[s]}
                  </button>
                ))}
              </div>
              {/* Zero/zero toggle */}
              {zeroZeroCount > 0 && (
                <button
                  onClick={() => setHideZeroZero(prev => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    borderColor: hideZeroZero ? 'var(--card-border)' : 'var(--primary)',
                    background: hideZeroZero ? 'transparent' : 'var(--primary-light)',
                    color: hideZeroZero ? 'var(--muted)' : 'var(--primary)',
                  }}
                >
                  {hideZeroZero ? <EyeOff size={12} /> : <Eye size={12} />}
                  {hideZeroZero ? `${zeroZeroCount} zero items hidden` : `Showing all (incl. ${zeroZeroCount} zero items)`}
                </button>
              )}
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search part number or description..."
                  className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm bg-white"
                  style={{ borderColor: 'var(--card-border)' }}
                />
              </div>
            </div>

            {/* Table meta (moved from below the table) */}
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <div>
                Showing {sorted.length} of {results.length} parts
                {hideZeroZero && zeroZeroCount > 0 && ` (${zeroZeroCount} zero items hidden)`}
              </div>
              {anyHasCount2 && (
                <div className="text-[10px]">Click C1/C2 to switch active count per row</div>
              )}
            </div>

            {/* Results table */}
            <div className="card overflow-hidden">
              <div className="overflow-auto max-h-[calc(100vh-360px)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-white" style={{ boxShadow: '0 1px 0 var(--card-border)' }}>
                    {/* Two-row header: main row + sub-columns for Count */}
                    <tr className="border-b bg-white" style={{ borderColor: 'var(--card-border)' }}>
                      <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider w-6 bg-white" rowSpan={2} title="Store">St</th>
                      <SortHeader label="Tier" field="tier" current={sortField} dir={sortDir} onSort={toggleSort} rowSpan={2} />
                      <SortHeader label="Part Number" field="part_number" current={sortField} dir={sortDir} onSort={toggleSort} rowSpan={2} />
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white" rowSpan={2}>Description</th>
                      <SortHeader label="Pastel" field="pastel_qty" current={sortField} dir={sortDir} onSort={toggleSort} align="right" rowSpan={2} />
                      {anyHasCount2 && (
                        <th className="text-center px-1 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider w-8 bg-white" rowSpan={2}></th>
                      )}
                      <th className="text-center px-1 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white" colSpan={4}
                        style={{ borderBottom: 'none' }}
                      >
                        Count
                      </th>
                      <SortHeader label="Var" field="variance_qty" current={sortField} dir={sortDir} onSort={toggleSort} align="right" rowSpan={2} />
                      <SortHeader label="%" field="variance_pct" current={sortField} dir={sortDir} onSort={toggleSort} align="right" rowSpan={2} />
                      <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white" rowSpan={2}>Status</th>
                      {isReviewable && (
                        <th className="text-center px-2 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white" rowSpan={2}>Actions</th>
                      )}
                    </tr>
                    <tr className="border-b bg-white" style={{ borderColor: 'var(--card-border)' }}>
                      <th className="text-right px-2 py-1 text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white">Part</th>
                      <th className="text-right px-2 py-1 text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white">WIP</th>
                      <th className="text-right px-2 py-1 text-[9px] font-semibold text-amber-600 uppercase tracking-wider bg-white">Ext</th>
                      <th className="text-right px-2 py-1 text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(r => (
                      <ResultRow
                        key={r.id}
                        result={r}
                        anyHasCount2={anyHasCount2}
                        showingCount2={count2Rows.has(r.id)}
                        isReviewable={!!isReviewable}
                        expanded={expandedId === r.id}
                        accepting={accepting === r.id}
                        breakdown={breakdowns[r.id]}
                        loadingBreakdown={loadingBreakdown === r.id}
                        excluded={excludedIds.has(r.id)}
                        onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        onAccept={(qty) => handleAcceptDeviation(r.id, qty)}
                        onUnaccept={() => handleUnaccept(r.id)}
                        onToggleFlag={() => handleToggleFlag(r.id, r.recount_flagged)}
                        onToggleCount={() => handleToggleCountVersion(r.id)}
                        onToggleExclude={() => handleToggleExclude(r.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {sorted.length === 0 && (
                <div className="p-8 text-center text-sm text-[var(--muted)]">
                  No results match your filters
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getActiveCountQty(r: CountResult, count2Rows: Set<string>): number | null {
  if (count2Rows.has(r.id) && r.count2_qty !== null) return r.count2_qty;
  return r.count1_qty;
}

function getActiveVarianceQty(r: CountResult, count2Rows: Set<string>): number {
  const counted = getActiveCountQty(r, count2Rows);
  if (counted === null) return 0;
  return counted - r.pastel_qty;
}

function getActiveVariancePct(r: CountResult, count2Rows: Set<string>): number {
  const counted = getActiveCountQty(r, count2Rows);
  if (counted === null) return 0;
  const varQty = counted - r.pastel_qty;
  return r.pastel_qty !== 0 ? (varQty / r.pastel_qty) * 100 : (counted !== 0 ? 100 : 0);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    amber: 'var(--warning)',
    red: 'var(--error)',
    green: '#22c55e',
  };
  return (
    <div className="card px-4 py-3">
      <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold mt-0.5" style={{
        fontFamily: 'var(--font-display)',
        color: color ? colorMap[color] : 'var(--foreground)',
      }}>
        {value}
      </div>
    </div>
  );
}

function SortHeader({ label, field, current, dir, onSort, align, rowSpan }: {
  label: string; field: SortField; current: SortField; dir: SortDir;
  onSort: (f: SortField) => void; align?: string; rowSpan?: number;
}) {
  const active = current === field;
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider cursor-pointer select-none hover:text-[var(--foreground)] transition-colors`}
      onClick={() => onSort(field)}
      rowSpan={rowSpan}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ArrowUpDown size={10} className="opacity-30" />
        )}
      </span>
    </th>
  );
}

const REASON_LABELS: Record<string, string> = {
  variance_exceeds_threshold: 'Variance exceeds tier threshold',
  round_number_variance: 'Suspiciously round variance',
  zero_count_with_pastel_balance: 'Zero count but Pastel has stock',
  uncounted_pastel_balance: 'Not counted but Pastel has stock',
  significant_change_vs_prior: 'Significant change vs prior period',
  manual_supervisor_flag: 'Manually flagged by supervisor',
};

function ResultRow({ result: r, anyHasCount2, showingCount2, isReviewable, expanded, accepting, breakdown, loadingBreakdown, excluded, onToggleExpand, onAccept, onUnaccept, onToggleFlag, onToggleCount, onToggleExclude }: {
  result: CountResult; anyHasCount2: boolean; showingCount2: boolean; isReviewable: boolean;
  expanded: boolean; accepting: boolean;
  breakdown?: CounterBreakdown; loadingBreakdown?: boolean;
  excluded?: boolean;
  onToggleExpand: () => void; onAccept: (qty: number) => void; onUnaccept: () => void;
  onToggleFlag: () => void; onToggleCount: () => void;
  onToggleExclude: () => void;
}) {
  // Active count: use C2 if toggled and available, else C1
  const useCount2 = showingCount2 && r.count2_qty !== null;
  const activeQty = useCount2 ? r.count2_qty : r.count1_qty;
  const activeDirect = useCount2 ? r.count2_direct_qty : r.count1_direct_qty;
  const activeWip = useCount2 ? r.count2_wip_qty : r.count1_wip_qty;
  const activeExternal = useCount2 ? r.count2_external_qty : r.count1_external_qty;

  // Compute variance from active count
  const varQty = activeQty !== null ? activeQty - r.pastel_qty : null;
  const varPct = activeQty !== null
    ? (r.pastel_qty !== 0 ? ((activeQty - r.pastel_qty) / r.pastel_qty) * 100 : (activeQty !== 0 ? 100 : 0))
    : null;

  const varianceColor = varQty == null ? 'var(--muted)'
    : varQty > 0 ? '#22c55e'
    : varQty < 0 ? 'var(--error)'
    : 'var(--muted)';

  const absVarPct = Math.abs(varPct ?? 0);

  // Store badge
  const storeBadge = r.store_code === '002'
    ? { label: 'Q', bg: '#fef3c7', color: '#b45309', border: 'var(--warning)' }
    : { label: 'M', bg: 'var(--primary-light)', color: 'var(--primary)', border: 'var(--primary)' };

  const hasCount2Data = r.count2_qty !== null;
  // Column count: St + Tier + Part# + Desc + Pastel + [C1/C2] + Part + WIP + Ext + Total + Var + % + Status + [Actions]
  const colCount = (anyHasCount2 ? 1 : 0) + (isReviewable ? 13 : 12);

  return (
    <>
      <tr
        className="border-b cursor-pointer hover:bg-slate-50 transition-colors"
        style={{ borderColor: 'var(--card-border)', opacity: excluded ? 0.45 : 1 }}
        onClick={onToggleExpand}
      >
        {/* Store badge */}
        <td className="px-2 py-2 text-center">
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold"
            style={{ background: storeBadge.bg, color: storeBadge.color, border: `1px solid ${storeBadge.border}` }}
            title={r.store_code === '002' ? 'Quarantine' : 'Main Store'}
          >
            {storeBadge.label}
          </span>
        </td>
        {/* Tier */}
        <td className="px-2 py-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            r.tier === 'A' ? 'bg-red-100 text-red-700'
            : r.tier === 'B' ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
          }`}>
            {r.tier}
          </span>
        </td>
        <td className="px-3 py-2 font-mono text-xs font-medium">{r.part_number}</td>
        <td className="px-3 py-2 text-xs text-[var(--muted)] max-w-[200px] truncate">{r.description}</td>
        <td className="px-3 py-2 text-xs text-right font-mono">{formatNum(r.pastel_qty)}</td>
        {/* C1/C2 toggle — own column, only when any row has Count 2 */}
        {anyHasCount2 && (
          <td className="px-1 py-2 text-center" onClick={e => e.stopPropagation()}>
            {hasCount2Data ? (
              <button
                onClick={onToggleCount}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: useCount2 ? '#7c3aed' : 'var(--card-border)',
                  background: useCount2 ? '#ede9fe' : 'transparent',
                  color: useCount2 ? '#7c3aed' : 'var(--muted)',
                }}
                title={useCount2 ? 'Showing Count 2 — click for Count 1' : 'Showing Count 1 — click for Count 2'}
              >
                {useCount2 ? 'C2' : 'C1'}
              </button>
            ) : null}
          </td>
        )}
        {/* Count: Part sub-column (direct scans only) */}
        <td className="px-2 py-2 text-xs text-right font-mono">
          {activeDirect ? (
            <span className="font-bold">{activeDirect}</span>
          ) : activeQty !== null ? (
            <span className="text-[var(--muted-light)]">—</span>
          ) : <span className="text-[var(--muted-light)]">—</span>}
        </td>
        {/* Count: WIP sub-column (BOM + chain credits) */}
        <td className="px-2 py-2 text-xs text-right font-mono text-[var(--muted)]">
          {activeWip ? activeWip : ''}
        </td>
        {/* Count: EXT sub-column (external supplier stock) */}
        <td className="px-2 py-2 text-xs text-right font-mono text-amber-600">
          {activeExternal ? formatNum(activeExternal) : ''}
        </td>
        {/* Count: TOTAL sub-column (active count total) */}
        <td className="px-2 py-2 text-xs text-right font-mono font-bold">
          {activeQty !== null ? formatNum(activeQty) : <span className="text-[var(--muted-light)]">—</span>}
        </td>
        {/* Variance */}
        <td className="px-3 py-2 text-xs text-right font-mono font-bold" style={{ color: varianceColor }}>
          {varQty !== null ? (varQty > 0 ? '+' : '') + formatNum(varQty) : '—'}
        </td>
        <td className="px-2 py-2 text-xs text-right font-mono" style={{ color: varianceColor }}>
          {varPct !== null ? formatNum(absVarPct) + '%' : '—'}
        </td>
        {/* Status */}
        <td className="px-2 py-2 text-center">
          {r.deviation_accepted === true ? (
            <CheckCircle size={16} className="inline text-green-500" />
          ) : r.recount_flagged ? (
            <AlertTriangle size={16} className="inline text-amber-500" />
          ) : varQty === 0 || varQty === null ? (
            <Check size={16} className="inline text-slate-300" />
          ) : (
            <XCircle size={16} className="inline text-[var(--muted-light)]" />
          )}
        </td>
        {/* Actions */}
        {isReviewable && (
          <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center gap-1">
              {r.deviation_accepted === true ? (
                <button
                  onClick={() => onUnaccept()}
                  disabled={accepting}
                  className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
                  title={`Accepted qty: ${r.accepted_qty}. Click to undo.`}
                >
                  {accepting ? '...' : 'Undo'}
                </button>
              ) : activeQty !== null ? (
                <button
                  onClick={() => onAccept(activeQty)}
                  disabled={accepting}
                  className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-700 font-semibold hover:bg-green-100 transition-colors disabled:opacity-50"
                  title={`Accept count of ${activeQty}`}
                >
                  {accepting ? '...' : `Accept ${activeQty}`}
                </button>
              ) : null}
              <button
                onClick={onToggleFlag}
                className={`p-1 rounded transition-colors ${
                  r.recount_flagged
                    ? 'text-amber-500 hover:text-amber-600'
                    : 'text-[var(--muted-light)] hover:text-amber-500'
                }`}
                title={r.recount_flagged ? 'Unflag for recount' : 'Flag for recount'}
              >
                <Flag size={14} />
              </button>
              <button
                onClick={onToggleExclude}
                className={`p-1 rounded transition-colors ${
                  excluded
                    ? 'text-[var(--primary)] hover:text-[var(--primary)]'
                    : 'text-[var(--muted-light)] hover:text-[var(--primary)]'
                }`}
                title={excluded ? 'Excluded from deviation calc — click to include' : 'Exclude from deviation calc (does not affect Pastel export)'}
              >
                <Calculator size={14} />
              </button>
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={colCount} className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Tier</div>
                <div>{TIER_LABELS[r.tier] || r.tier}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Unit Cost</div>
                <div>{r.unit_cost !== null ? `R${Number(r.unit_cost).toFixed(2)}` : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Value Variance</div>
                <div style={{ color: varianceColor }}>
                  {r.unit_cost !== null && varQty !== null
                    ? `R${(varQty * Number(r.unit_cost)).toFixed(2)}`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Accepted Qty</div>
                <div>{r.accepted_qty !== null ? r.accepted_qty : '—'}</div>
              </div>
              {/* Show both counts in detail if count 2 exists */}
              {hasCount2Data && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-1">Count History</div>
                  <div className="flex gap-6">
                    <div>
                      <span className="text-[10px] text-[var(--muted)]">Count 1:</span>{' '}
                      <span className="font-mono font-bold">{r.count1_qty ?? '—'}</span>
                      {(r.count1_wip_qty || r.count1_external_qty) ? <span className="text-[10px] text-[var(--muted)]"> ({r.count1_direct_qty ?? 0} part{r.count1_wip_qty ? ` + ${r.count1_wip_qty} wip` : ''}{r.count1_external_qty ? ` + ${r.count1_external_qty} ext` : ''})</span> : null}
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--muted)]">Count 2:</span>{' '}
                      <span className="font-mono font-bold">{r.count2_qty ?? '—'}</span>
                      {(r.count2_wip_qty || r.count2_external_qty) ? <span className="text-[10px] text-[var(--muted)]"> ({r.count2_direct_qty ?? 0} part{r.count2_wip_qty ? ` + ${r.count2_wip_qty} wip` : ''}{r.count2_external_qty ? ` + ${r.count2_external_qty} ext` : ''})</span> : null}
                    </div>
                  </div>
                </div>
              )}
              {r.recount_reasons.length > 0 && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Recount Reasons</div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.recount_reasons.map(reason => (
                      <span key={reason} className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                        {REASON_LABELS[reason] || reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {r.accepted_by && (
                <div className="col-span-2">
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-0.5">Accepted By</div>
                  <div>{r.accepted_by} {r.accepted_at ? `at ${new Date(r.accepted_at).toLocaleString()}` : ''}</div>
                </div>
              )}
              {/* Per-counter breakdown */}
              {loadingBreakdown && (
                <div className="col-span-2 md:col-span-4 text-[11px] text-[var(--muted)]">Loading counter breakdown...</div>
              )}
              {breakdown && (breakdown.count1.length > 0 || breakdown.count2.length > 0) && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase mb-1">Counter Breakdown</div>
                  <div className="flex flex-col sm:flex-row gap-6">
                    {[
                      { label: 'Count 1', entries: breakdown.count1 },
                      { label: 'Count 2', entries: breakdown.count2 },
                    ].filter(g => g.entries.length > 0).map(group => (
                      <div key={group.label}>
                        <div className="text-[10px] text-[var(--muted)] mb-1">{group.label}</div>
                        <table className="text-[11px]">
                          <thead>
                            <tr>
                              <th className="text-left pr-3 text-[9px] font-semibold text-[var(--muted)] uppercase pb-0.5"></th>
                              <th className="text-right px-2 text-[9px] font-semibold text-[var(--muted)] uppercase pb-0.5">Part</th>
                              <th className="text-right px-2 text-[9px] font-semibold text-[var(--muted)] uppercase pb-0.5">WIP</th>
                              <th className="text-right px-2 text-[9px] font-semibold text-amber-600 uppercase pb-0.5">Ext</th>
                              <th className="text-right pl-3 text-[9px] font-semibold text-[var(--muted)] uppercase pb-0.5">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.entries.map((c, i) => (
                              <tr key={i}>
                                <td className="pr-3 font-medium">{c.counter}</td>
                                <td className="text-right px-2 font-mono">{c.direct || '—'}</td>
                                <td className="text-right px-2 font-mono text-[var(--muted)]">{c.wip || '—'}</td>
                                <td className="text-right px-2 font-mono text-amber-600">{c.ext || '—'}</td>
                                <td className="text-right pl-3 font-mono font-bold">{c.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
