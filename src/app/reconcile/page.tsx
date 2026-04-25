'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, X, ArrowLeft,
  Search, ArrowUpDown, CheckCircle, XCircle, Flag, Printer, ListChecks,
  EyeOff, Eye, RotateCcw, Calculator,
} from 'lucide-react';
import type { StockTake, CountResult } from '@/types';
import { STORE_LABELS, TIER_LABELS, RECOUNT_THRESHOLDS, RECOUNT_ZAR_THRESHOLD } from '@/lib/constants';

type TileFilter = 'off' | 'include' | 'exclude';
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

// Wrap in Suspense for useSearchParams (required by Next.js)
export default function ReconcilePageWrapper() {
  return <Suspense><ReconcilePageInner /></Suspense>;
}

function ReconcilePageInner() {
  const searchParams = useSearchParams();
  const specificStockTakeId = searchParams.get('stockTakeId');

  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [results, setResults] = useState<CountResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [flaggedFilter, setFlaggedFilter] = useState<TileFilter>('off');
  const [acceptedFilter, setAcceptedFilter] = useState<TileFilter>('off');
  const [remainingFilter, setRemainingFilter] = useState<TileFilter>('off');
  const [uncountedFilter, setUncountedFilter] = useState<TileFilter>('off');
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
  const [count2Rows, setCount2Rows] = useState<Set<string>>(new Set());
  const [breakdowns, setBreakdowns] = useState<Record<string, CounterBreakdown>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const isReadOnly = stockTake?.status === 'complete';

  const fetchData = useCallback(async () => {
    try {
      let st: StockTake | null = null;
      if (specificStockTakeId) {
        // Load specific stock take by ID (for viewing history)
        const res = await fetch(`/api/stock-takes`);
        const all = await res.json();
        st = (Array.isArray(all) ? all : []).find((s: StockTake) => s.id === specificStockTakeId) ?? null;
      } else {
        const stRes = await fetch('/api/stock-takes/active');
        const stData = await stRes.json();
        st = stData?.stockTake ?? null;
      }
      setStockTake(st);

      if (st) {
        setExcludedIds(loadExcludedIds(st.id));
        const crRes = await fetch(`/api/count-results?stockTakeId=${st.id}&filter=all`);
        const crData = await crRes.json();
        const arr: CountResult[] = Array.isArray(crData) ? crData : [];
        setResults(arr);
        const autoC2 = new Set<string>();
        for (const r of arr) {
          if (shouldPreferCount2(r)) autoC2.add(r.id);
        }
        setCount2Rows(autoC2);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [specificStockTakeId]);

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

  // Filter by tile filters + toggles + store + search + zero/zero (all client-side)
  const filtered = results.filter(r => {
    // Tile filters (composable, not mutually exclusive)
    if (flaggedFilter === 'include' && !r.recount_flagged) return false;
    if (flaggedFilter === 'exclude' && r.recount_flagged) return false;
    if (acceptedFilter === 'include' && r.deviation_accepted !== true) return false;
    if (acceptedFilter === 'exclude' && r.deviation_accepted === true) return false;
    if (remainingFilter !== 'off') {
      const isZeroZero = r.pastel_qty === 0 && (r.count1_qty === null || r.count1_qty === 0);
      const isRemaining = !isZeroZero && !r.deviation_accepted;
      if (remainingFilter === 'include' && !isRemaining) return false;
      if (remainingFilter === 'exclude' && isRemaining) return false;
    }
    // Uncounted tile filter
    if (uncountedFilter === 'include' && r.count1_qty !== null) return false;
    if (uncountedFilter === 'exclude' && r.count1_qty === null) return false;
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
  const uncountedParts = results.filter(r => {
    if (r.count1_qty !== null) return false;
    if (hideZeroZero && r.pastel_qty === 0) return false;
    return true;
  }).length;
  const acceptedParts = results.filter(r => r.deviation_accepted === true).length;
  const remainingCount = useMemo(() =>
    results.filter(r => {
      const isZeroZero = r.pastel_qty === 0 && (r.count1_qty === null || r.count1_qty === 0);
      return !isZeroZero && !r.deviation_accepted;
    }).length,
    [results]
  );
  const anyHasCount2 = results.some(r => r.count2_qty !== null);

  // 3-way tile filter cycle: off → include → exclude → off
  const cycleTileFilter = useCallback((setter: React.Dispatch<React.SetStateAction<TileFilter>>) => {
    setter(prev => prev === 'off' ? 'include' : prev === 'include' ? 'exclude' : 'off');
  }, []);

  // Overall deviation: sum(abs(variance)) / sum(counted qty) across all counted items
  const deviationStats = useMemo(() => {
    let totalCounted = 0;
    let totalPastel = 0;            // stable baseline — all inventory, regardless of count state
    let totalStockValuation = 0;    // sum of pastel_qty × unit_cost across all rows
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
      if (r.unit_cost) totalStockValuation += r.pastel_qty * Number(r.unit_cost);
      // Active count follows the per-row C1/C2 toggle. accepted_qty is the value
      // committed to Pastel export but does NOT lock the deviation preview —
      // toggling C2 on an already-accepted row should still update the metric so
      // supervisors can see "what if" scenarios while reviewing.
      const useC2 = count2Rows.has(r.id) && r.count2_qty !== null;
      const toggleQty = useC2 ? r.count2_qty : r.count1_qty;
      const counted = toggleQty ?? r.accepted_qty;
      if (counted === null) continue;
      countedParts++;
      totalCounted += counted;
      const variance = counted - r.pastel_qty;
      totalAbsVariance += Math.abs(variance);
      if (r.unit_cost) totalValueVariance += Math.abs(variance) * Number(r.unit_cost);
    }
    // Quantity deviation: abs variance / total Pastel qty
    const overallPct = totalPastel > 0 ? (totalAbsVariance / totalPastel) * 100 : 0;
    // Value deviation: value variance / total stock valuation
    const valuePct = totalStockValuation > 0 ? (totalValueVariance / totalStockValuation) * 100 : 0;
    return { totalCounted, totalPastel, totalStockValuation, totalAbsVariance, totalValueVariance, overallPct, valuePct, countedParts, excludedFromCalc };
  }, [results, excludedIds, count2Rows]);

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

  const isReviewable = !isReadOnly && (stockTake?.status === 'reviewing' || stockTake?.status === 'recount');
  const isRecount = stockTake?.status === 'recount';
  const [reopening, setReopening] = useState(false);
  const [reaggregating, setReaggregating] = useState(false);

  // Re-aggregate: re-run end-counting logic without changing status or round
  const handleReaggregate = async () => {
    if (!stockTake) return;
    setReaggregating(true);
    try {
      const res = await fetch(`/api/stock-takes/${stockTake.id}/end-counting?reaggregate=true`, {
        method: 'POST',
      });
      if (res.ok) {
        setBreakdowns({}); // clear cached breakdowns so they re-fetch
        await fetchData();
      }
    } catch { /* ignore */ }
    finally { setReaggregating(false); }
  };

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
            {/* Read-only banner */}
            {isReadOnly && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                <CheckCircle size={16} className="flex-shrink-0 text-emerald-500" />
                <span>Viewing completed stock take: <strong>{stockTake?.reference}</strong></span>
                <Link href="/" className="ml-auto flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-medium text-xs">
                  <ArrowLeft size={12} /> Back to Dashboard
                </Link>
              </div>
            )}

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
                  <>
                    <button
                      onClick={handleReaggregate}
                      disabled={reaggregating}
                      className="h-9 px-4 rounded-lg border text-sm font-semibold flex items-center gap-1.5 transition-colors hover:bg-blue-50 cursor-pointer disabled:opacity-50"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    >
                      <RotateCcw size={14} className={reaggregating ? 'animate-spin' : ''} />
                      {reaggregating ? 'Re-aggregating...' : 'Re-aggregate'}
                    </button>
                    <button
                      onClick={handleReopenCounting}
                      disabled={reopening}
                      className="h-9 px-4 rounded-lg border text-sm font-semibold flex items-center gap-1.5 transition-colors hover:bg-orange-50 cursor-pointer disabled:opacity-50"
                      style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                    >
                      <RotateCcw size={14} />
                      {reopening ? 'Reopening...' : 'Reopen Counting'}
                    </button>
                  </>
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

            {/* Summary card */}
            <div className="card p-0 overflow-hidden">
              <div className="flex flex-col lg:flex-row">
                {/* Primary deviations: quantity + value */}
                <div className="flex-1 flex flex-col">
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: 'var(--card-border)' }}>
                    <DeviationTile
                      label="Quantity Deviation"
                      percent={deviationStats.overallPct}
                      primary={`${formatNum(deviationStats.totalAbsVariance)} units variance`}
                      secondary={`of ${formatNum(deviationStats.totalPastel)} Pastel units`}
                    />
                    <DeviationTile
                      label="Value Deviation"
                      percent={deviationStats.valuePct}
                      primary={`R${deviationStats.totalValueVariance.toLocaleString(undefined, { maximumFractionDigits: 0 })} variance`}
                      secondary={`of R${deviationStats.totalStockValuation.toLocaleString(undefined, { maximumFractionDigits: 0 })} stock value`}
                    />
                  </div>
                  {deviationStats.excludedFromCalc > 0 && (
                    <div className="px-7 py-1.5 text-[10px] italic border-t" style={{ color: 'var(--muted-light)', borderColor: 'var(--card-border)' }}>
                      {deviationStats.excludedFromCalc} {deviationStats.excludedFromCalc === 1 ? 'item' : 'items'} excluded from both calculations
                    </div>
                  )}
                </div>

                {/* Secondary counts — clickable 3-way filters */}
                <div className="lg:w-[52%] lg:flex-shrink-0 border-t lg:border-t-0 lg:border-l grid grid-cols-5" style={{ borderColor: 'var(--card-border)' }}>
                  <FilterTile label="Total" value={totalParts} />
                  <FilterTile label="Flagged" value={flaggedParts}
                    color={flaggedParts > 0 ? '#f59e0b' : undefined}
                    filterState={flaggedFilter} onCycleFilter={() => cycleTileFilter(setFlaggedFilter)} />
                  <FilterTile label="Uncounted" value={uncountedParts}
                    color={uncountedParts > 0 ? '#6366f1' : undefined}
                    filterState={uncountedFilter} onCycleFilter={() => cycleTileFilter(setUncountedFilter)} />
                  <FilterTile label="Accepted" value={acceptedParts}
                    color={acceptedParts > 0 ? '#10b981' : undefined}
                    filterState={acceptedFilter} onCycleFilter={() => cycleTileFilter(setAcceptedFilter)} />
                  <FilterTile label="Remaining" value={remainingCount}
                    color={remainingCount === 0 ? '#10b981' : undefined}
                    filterState={remainingFilter} onCycleFilter={() => cycleTileFilter(setRemainingFilter)} />
                </div>
              </div>
            </div>

            {/* Filters + Search */}
            <div className="flex flex-wrap items-center gap-3">
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
                        <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider bg-white" rowSpan={2}>Actions</th>
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
                        onReaggregate={handleReaggregate}
                        reaggregating={reaggregating}
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

      {/* Slide-in detail panel */}
      <DetailPanel
        result={expandedId ? results.find(r => r.id === expandedId) ?? null : null}
        showingCount2={expandedId ? count2Rows.has(expandedId) : false}
        breakdown={expandedId ? breakdowns[expandedId] : undefined}
        loadingBreakdown={!!loadingBreakdown}
        reaggregating={reaggregating}
        onClose={() => setExpandedId(null)}
        onReaggregate={handleReaggregate}
      />
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

function DeviationTile({ label, percent, primary, secondary }: {
  label: string; percent: number; primary: string; secondary: string;
}) {
  // Color tier: green ≤3%, amber ≤10%, red >10%
  const accent = percent <= 3 ? '#10b981' : percent <= 10 ? '#f59e0b' : '#ef4444';
  const tintBg = percent <= 3 ? 'rgba(16,185,129,0.08)' : percent <= 10 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
  // Ring visual is scaled to a 0–20% deviation range so the critical
  // "good zone" (0–5%) has meaningful resolution. Anything ≥20% pegs
  // the ring at 0% fill (fully drained) — the exact % is still shown
  // in the centre text and the color tier captures severity above 10%.
  const RING_MAX = 20;
  const clampedPct = Math.min(RING_MAX, Math.max(0, percent));
  const dash = 100 - (clampedPct / RING_MAX) * 100;
  const gradId = `grad-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="px-7 py-6 flex items-center gap-6 relative overflow-hidden">
      {/* Subtle tinted background by deviation level */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: tintBg }} />

      <div className="relative w-[92px] h-[92px] flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.85" />
              <stop offset="100%" stopColor={accent} stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="2.6" />
          <circle
            cx="18" cy="18" r="15.5" fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="2.6"
            strokeDasharray={`${dash} 100`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: 'var(--font-display)' }}>
          <div className="inline-flex items-baseline">
            <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: accent, letterSpacing: '-0.02em' }}>
              {percent.toFixed(1)}
            </span>
            <span className="text-[13px] font-semibold ml-0.5" style={{ color: accent, opacity: 0.75 }}>%</span>
          </div>
        </div>
      </div>

      <div className="relative min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.1em' }}>
          {label}
        </div>
        <div className="text-[13px] font-semibold mt-1.5 tabular-nums" style={{ color: 'var(--foreground)' }}>
          {primary}
        </div>
        <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'var(--muted)' }}>
          {secondary}
        </div>
      </div>
    </div>
  );
}

function FilterTile({ label, value, color, filterState, onCycleFilter }: {
  label: string; value: number; color?: string;
  filterState?: TileFilter; onCycleFilter?: () => void;
}) {
  const isClickable = !!onCycleFilter;
  const isInclude = filterState === 'include';
  const isExclude = filterState === 'exclude';
  const activeColor = color || 'var(--primary)';

  return (
    <div
      onClick={onCycleFilter}
      className={`relative px-2 py-6 flex flex-col items-center justify-center gap-1.5 border-l first:border-l-0 transition-all duration-200 ${isClickable ? 'cursor-pointer select-none group' : ''}`}
      style={{
        borderColor: 'var(--card-border)',
        background: isInclude
          ? (typeof activeColor === 'string' && activeColor.startsWith('#')
              ? `${activeColor}0a` : 'rgba(37,99,235,0.04)')
          : isExclude ? 'rgba(239,68,68,0.03)' : 'transparent',
      }}
      title={isClickable ? (
        isInclude ? `Showing ${label.toLowerCase()} only — click to exclude`
        : isExclude ? `Hiding ${label.toLowerCase()} — click to clear filter`
        : `Click to filter by ${label.toLowerCase()}`
      ) : undefined}
    >
      {/* Bottom accent bar — slides in on filter activation */}
      <div
        className="absolute bottom-0 left-2 right-2 rounded-t-full transition-all duration-300"
        style={{
          height: (isInclude || isExclude) ? 3 : 0,
          background: isInclude ? activeColor : '#ef4444',
          opacity: (isInclude || isExclude) ? 1 : 0,
        }}
      />

      {/* Hover hint for clickable tiles */}
      {isClickable && filterState === 'off' && (
        <div className="absolute bottom-0 left-3 right-3 h-[2px] rounded-t-full bg-slate-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      )}

      {/* Label with filter state indicator */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-semibold uppercase transition-colors duration-200" style={{
          color: isInclude ? activeColor : isExclude ? '#ef4444' : 'var(--muted)',
          letterSpacing: '0.12em',
        }}>
          {label}
        </span>
        {isInclude && <Check size={9} style={{ color: activeColor }} strokeWidth={3} />}
        {isExclude && <X size={9} className="text-red-400" strokeWidth={3} />}
      </div>

      {/* Number with strikethrough on exclude */}
      <div className="relative text-[26px] font-bold tabular-nums leading-none transition-all duration-200" style={{
        fontFamily: 'var(--font-display)',
        color: isExclude ? 'var(--muted-light)' : (color || 'var(--foreground)'),
        letterSpacing: '-0.02em',
        opacity: isExclude ? 0.35 : 1,
      }}>
        {value.toLocaleString()}
        {isExclude && (
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-[2px] bg-red-300/70 rounded-full" />
          </div>
        )}
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

function ResultRow({ result: r, anyHasCount2, showingCount2, isReviewable, expanded, accepting, breakdown, loadingBreakdown, excluded, onToggleExpand, onAccept, onUnaccept, onToggleFlag, onToggleCount, onToggleExclude, onReaggregate, reaggregating }: {
  result: CountResult; anyHasCount2: boolean; showingCount2: boolean; isReviewable: boolean;
  expanded: boolean; accepting: boolean;
  breakdown?: CounterBreakdown; loadingBreakdown?: boolean;
  excluded?: boolean;
  onToggleExpand: () => void; onAccept: (qty: number) => void; onUnaccept: () => void;
  onToggleFlag: () => void; onToggleCount: () => void;
  onToggleExclude: () => void;
  onReaggregate: () => void; reaggregating: boolean;
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
        className={`border-b cursor-pointer transition-colors ${expanded ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
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
        <td className="px-3 py-2 text-xs text-right font-mono font-bold">{formatNum(r.pastel_qty)}</td>
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
            <span>{activeDirect}</span>
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
            <div
              className="flex flex-col items-center gap-0.5"
              title={r.accepted_qty !== activeQty
                ? `Accepted: ${r.accepted_qty} (active count is ${activeQty})`
                : `Accepted: ${r.accepted_qty}`}
            >
              <CheckCircle size={16} className={
                r.accepted_qty !== activeQty ? "text-amber-500" : "text-green-500"
              } />
              <span className={`text-[9px] font-mono font-bold leading-none px-1 py-0.5 rounded ${
                r.accepted_qty !== activeQty
                  ? 'bg-amber-50 text-amber-600'
                  : 'text-green-600/60'
              }`}>
                {r.accepted_qty}
              </span>
            </div>
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
          <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-end gap-1">
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
      {/* Detail panel is now a slide-in at page level — no inline expansion */}
    </>
  );
}

// ── Slide-in Detail Panel ────────────────────────────────────────────────────

function DetailPanel({ result: r, showingCount2, breakdown, loadingBreakdown, reaggregating, onClose, onReaggregate }: {
  result: CountResult | null;
  showingCount2: boolean;
  breakdown?: CounterBreakdown;
  loadingBreakdown: boolean;
  reaggregating: boolean;
  onClose: () => void;
  onReaggregate: () => void;
}) {
  const isOpen = !!r;

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      document.addEventListener('keydown', handleKey);
      return () => document.removeEventListener('keydown', handleKey);
    }
  }, [isOpen, onClose]);

  // Compute variance from the active count (follows C1/C2 toggle in main table)
  const useC2 = showingCount2 && r?.count2_qty !== null;
  const activeQty = r ? (useC2 ? r.count2_qty : r.count1_qty) : null;
  const varQty = r && activeQty !== null ? activeQty - r.pastel_qty : null;
  const varianceColor = varQty == null ? 'var(--muted)' : varQty > 0 ? '#22c55e' : varQty < 0 ? 'var(--error)' : 'var(--muted)';

  // Sync detection
  const bdC1Total = breakdown?.count1.reduce((s, c) => s + c.total, 0) ?? null;
  const bdC2Total = breakdown?.count2.reduce((s, c) => s + c.total, 0) ?? null;
  const c1OutOfSync = breakdown && r && bdC1Total !== null && r.count1_qty !== null && bdC1Total !== r.count1_qty;
  const c2OutOfSync = breakdown && r && bdC2Total !== null && r.count2_qty !== null && bdC2Total !== r.count2_qty;
  const outOfSync = c1OutOfSync || c2OutOfSync;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/10 z-40 transition-opacity duration-250 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white border-l shadow-2xl z-50 flex flex-col transition-transform duration-250 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ borderColor: 'var(--card-border)' }}
      >
        {r && (
          <>
            {/* Header */}
            <div className="flex-shrink-0 border-b px-5 py-4" style={{ borderColor: 'var(--card-border)', background: '#f8fafc' }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-base font-bold" style={{ fontFamily: 'var(--font-mono)' }}>{r.part_number}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">{r.description || 'No description'}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.tier === 'A' ? 'bg-red-100 text-red-700'
                      : r.tier === 'B' ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}>{r.tier}</span>
                    <span className="text-[10px] text-[var(--muted)]">{STORE_LABELS[r.store_code] || r.store_code}</span>
                  </div>
                </div>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 transition-colors text-[var(--muted)]">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

              {/* Sync warning */}
              {outOfSync && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0 text-amber-500" />
                    <span>
                      Totals out of sync
                      {c2OutOfSync && ` (C2: ${bdC2Total} vs ${r.count2_qty})`}
                      {c1OutOfSync && ` (C1: ${bdC1Total} vs ${r.count1_qty})`}
                    </span>
                  </div>
                  <button
                    onClick={onReaggregate}
                    disabled={reaggregating}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    <RotateCcw size={12} className={reaggregating ? 'animate-spin' : ''} />
                    {reaggregating ? 'Syncing...' : 'Re-aggregate'}
                  </button>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Pastel Qty', value: r.pastel_qty },
                  { label: 'Unit Cost', value: r.unit_cost !== null ? `R${Number(r.unit_cost).toFixed(2)}` : '—' },
                  { label: 'Value Variance', value: r.unit_cost !== null && varQty !== null ? `R${(varQty * Number(r.unit_cost)).toFixed(2)}` : '—', color: varianceColor },
                  { label: 'Accepted Qty', value: r.accepted_qty !== null ? r.accepted_qty : '—' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--card-border)' }}>
                    <div className="text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wide">{stat.label}</div>
                    <div className="text-sm font-semibold mt-0.5" style={stat.color ? { color: stat.color } : undefined}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Previous Stock Take reference */}
              {r.prev_stock_take_qty !== null && (() => {
                const currentQty = r.accepted_qty ?? (useC2 ? r.count2_qty : r.count1_qty);
                const delta = currentQty !== null ? currentQty - r.prev_stock_take_qty : null;
                return (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--card-border)', background: '#f0fdf4' }}>
                    <div className="flex-1">
                      <div className="text-[9px] font-semibold text-emerald-700 uppercase tracking-wide">Previous Stock Take</div>
                      <div className="font-mono text-sm font-bold mt-0.5">{r.prev_stock_take_qty}</div>
                    </div>
                    {delta !== null && delta !== 0 && (
                      <div className="text-right">
                        <div className="text-[9px] text-[var(--muted)] uppercase">Change</div>
                        <div className={`font-mono text-sm font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {delta > 0 ? '+' : ''}{delta}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Count History — compact summary */}
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">Count History</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--card-border)', background: '#f8fafc' }}>
                    <div className="text-[9px] font-bold text-[var(--muted)] uppercase">Count 1</div>
                    <div className="font-mono text-lg font-bold mt-0.5">{r.count1_qty ?? '—'}</div>
                    {(r.count1_direct_qty || r.count1_wip_qty || r.count1_external_qty) && (
                      <div className="text-[10px] text-[var(--muted)] mt-0.5">
                        {r.count1_direct_qty ?? 0} part{r.count1_wip_qty ? ` + ${r.count1_wip_qty} wip` : ''}{r.count1_external_qty ? ` + ${r.count1_external_qty} ext` : ''}
                      </div>
                    )}
                  </div>
                  {r.count2_qty !== null && (
                    <div className="rounded-lg border px-3 py-2" style={{ borderColor: '#c4b5fd', background: '#f5f3ff' }}>
                      <div className="text-[9px] font-bold uppercase" style={{ color: '#7c3aed' }}>Count 2</div>
                      <div className="font-mono text-lg font-bold mt-0.5">{r.count2_qty}</div>
                      {(r.count2_direct_qty || r.count2_wip_qty || r.count2_external_qty) && (
                        <div className="text-[10px] mt-0.5" style={{ color: '#7c3aed80' }}>
                          {r.count2_direct_qty ?? 0} part{r.count2_wip_qty ? ` + ${r.count2_wip_qty} wip` : ''}{r.count2_external_qty ? ` + ${r.count2_external_qty} ext` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Recount reasons */}
              {r.recount_reasons.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">Recount Reasons</div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.recount_reasons.map(reason => (
                      <span key={reason} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                        {REASON_LABELS[reason] || reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Accepted by */}
              {r.accepted_by && (
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                  <span>{r.accepted_by}{r.accepted_at ? ` · ${new Date(r.accepted_at).toLocaleString()}` : ''}</span>
                </div>
              )}

              {/* Counter Breakdown */}
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">Counter Breakdown</div>
                {loadingBreakdown && (
                  <div className="flex items-center gap-2 py-4 text-[11px] text-[var(--muted)]">
                    <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </div>
                )}
                {breakdown && (breakdown.count1.length > 0 || breakdown.count2.length > 0) && (
                  <div className="space-y-3">
                    {[
                      { label: 'Count 1', entries: breakdown.count1, storedQty: r.count1_qty, isStale: c1OutOfSync },
                      { label: 'Count 2', entries: breakdown.count2, storedQty: r.count2_qty, isStale: c2OutOfSync },
                    ].filter(g => g.entries.length > 0 && g.storedQty !== null).map(group => {
                      const groupTotal = group.entries.reduce((s, c) => s + c.total, 0);
                      const groupDirect = group.entries.reduce((s, c) => s + c.direct, 0);
                      const groupWip = group.entries.reduce((s, c) => s + c.wip, 0);
                      const groupExt = group.entries.reduce((s, c) => s + c.ext, 0);
                      return (
                        <div key={group.label} className="rounded-lg border overflow-hidden" style={{ borderColor: group.isStale ? '#fbbf24' : 'var(--card-border)' }}>
                          <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: 'var(--card-border)', background: group.label === 'Count 2' ? '#f5f3ff' : '#f8fafc' }}>
                            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: group.label === 'Count 2' ? '#7c3aed' : 'var(--muted)' }}>
                              {group.label}
                            </span>
                            <span className="font-mono text-sm font-bold" style={{ color: group.isStale ? '#d97706' : undefined }}>
                              {groupTotal}
                              {group.isStale && (
                                <span className="text-[9px] font-normal text-amber-500 ml-1">(stored: {group.storedQty})</span>
                              )}
                            </span>
                          </div>
                          <table className="w-full text-[11px]" style={{ tableLayout: 'fixed' }}>
                            <colgroup>
                              <col style={{ width: '38%' }} />
                              <col style={{ width: '15.5%' }} />
                              <col style={{ width: '15.5%' }} />
                              <col style={{ width: '15.5%' }} />
                              <col style={{ width: '15.5%' }} />
                            </colgroup>
                            <thead>
                              <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                                <th className="text-left pl-3 pr-2 py-1.5 text-[9px] font-semibold text-[var(--muted)] uppercase">Counter</th>
                                <th className="text-right px-2 py-1.5 text-[9px] font-semibold text-[var(--muted)] uppercase">Part</th>
                                <th className="text-right px-2 py-1.5 text-[9px] font-semibold text-[var(--muted)] uppercase">WIP</th>
                                <th className="text-right px-2 py-1.5 text-[9px] font-semibold text-amber-600 uppercase">Ext</th>
                                <th className="text-right px-2 pr-3 py-1.5 text-[9px] font-semibold text-[var(--muted)] uppercase">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.entries.map((c, i) => {
                                const isCarried = c.counter === 'Carried from Count 1';
                                return (
                                  <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--card-border)', opacity: isCarried ? 0.55 : 1 }}>
                                    <td className={`pl-3 pr-2 py-1.5 font-medium truncate ${isCarried ? 'italic text-[var(--muted)] text-[10px]' : ''}`}>{c.counter}</td>
                                    <td className={`text-right px-2 py-1.5 font-mono ${!isCarried && group.label === 'Count 2' && c.direct ? 'text-[var(--primary)] font-bold' : ''}`}>{c.direct || '—'}</td>
                                    <td className={`text-right px-2 py-1.5 font-mono ${!isCarried && group.label === 'Count 2' && c.wip ? 'text-[var(--primary)] font-bold' : 'text-[var(--muted)]'}`}>{c.wip || '—'}</td>
                                    <td className={`text-right px-2 py-1.5 font-mono ${!isCarried && group.label === 'Count 2' && c.ext ? 'text-amber-600 font-bold' : 'text-amber-600'}`}>{c.ext || '—'}</td>
                                    <td className="text-right px-2 pr-3 py-1.5 font-mono font-semibold">{c.total}</td>
                                  </tr>
                                );
                              })}
                              {group.entries.length > 1 && (
                                <tr className="bg-slate-50/80">
                                  <td className="pl-3 pr-2 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase">Total</td>
                                  <td className="text-right px-2 py-1.5 font-mono font-bold">{groupDirect || '—'}</td>
                                  <td className="text-right px-2 py-1.5 font-mono font-bold text-[var(--muted)]">{groupWip || '—'}</td>
                                  <td className="text-right px-2 py-1.5 font-mono font-bold text-amber-600">{groupExt || '—'}</td>
                                  <td className="text-right px-2 pr-3 py-1.5 font-mono font-bold">{groupTotal}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
