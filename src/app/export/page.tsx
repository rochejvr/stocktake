'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Download, FileSpreadsheet, AlertTriangle, CheckCircle, Settings,
} from 'lucide-react';
import type { StockTake } from '@/types';

interface ExportStats {
  totalAccepted: number;
  withVariance: number;
  zeroVariance: number;
  totalAdjustmentQty: number;
  totalAdjustmentValue: number;
  store001Count: number;
  store002Count: number;
}

export default function ExportPage() {
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [glCode, setGlCode] = useState('2100000');
  const [includeZero, setIncludeZero] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const stRes = await fetch('/api/stock-takes/active');
      const stData = await stRes.json();
      const st: StockTake | null = stData?.stockTake ?? null;
      setStockTake(st);

      if (st) {
        // Fetch all accepted results for stats
        const crRes = await fetch(`/api/count-results?stockTakeId=${st.id}&filter=all`);
        const crData = await crRes.json();
        const results = Array.isArray(crData) ? crData : [];

        const accepted = results.filter((r: Record<string, unknown>) => r.deviation_accepted === true);
        let withVar = 0;
        let zeroVar = 0;
        let totalQty = 0;
        let totalVal = 0;
        let s001 = 0;
        let s002 = 0;

        for (const r of accepted) {
          const varQty = (r.accepted_qty ?? 0) - r.pastel_qty;
          if (varQty !== 0) {
            withVar++;
            totalQty += varQty;
            if (r.unit_cost) totalVal += varQty * Number(r.unit_cost);
          } else {
            zeroVar++;
          }
          if (r.store_code === '001') s001++;
          else s002++;
        }

        setStats({
          totalAccepted: accepted.length,
          withVariance: withVar,
          zeroVariance: zeroVar,
          totalAdjustmentQty: totalQty,
          totalAdjustmentValue: totalVal,
          store001Count: s001,
          store002Count: s002,
        });

        // Not accepted yet
        const notAccepted = results.filter((r: Record<string, unknown>) =>
          r.deviation_accepted !== true && r.count1_qty !== null
        );
        if (notAccepted.length > 0) {
          // Store count for warning
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePreview = async () => {
    if (!stockTake) return;
    try {
      const res = await fetch(
        `/api/stock-takes/${stockTake.id}/export?glCode=${encodeURIComponent(glCode)}&includeZero=${includeZero}`
      );
      if (!res.ok) return;
      const text = await res.text();
      setPreviewRows(text.split('\n').filter(Boolean));
    } catch { /* ignore */ }
  };

  const handleDownload = async () => {
    if (!stockTake) return;
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/stock-takes/${stockTake.id}/export?glCode=${encodeURIComponent(glCode)}&includeZero=${includeZero}`
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stockTake.reference || 'stock-take'}_journal.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    finally { setDownloading(false); }
  };

  const canExport = stockTake?.status === 'reviewing' || stockTake?.status === 'complete';
  const rowCount = includeZero ? stats?.totalAccepted : stats?.withVariance;

  return (
    <AppShell>
      <div className="p-8">
        {loading && (
          <div className="flex items-center justify-center h-64 text-[var(--muted)]">
            <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && !canExport && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center text-[var(--muted)]">
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
              <div className="font-medium text-[var(--foreground)]">Export to Pastel</div>
              <div className="text-sm mt-1">
                {!stockTake
                  ? 'No active stock take'
                  : `Stock take is in '${stockTake.status}' status — complete reconciliation first`}
              </div>
            </div>
          </div>
        )}

        {!loading && canExport && stats && (
          <div className="space-y-6 fade-in">
            {/* Header */}
            <div>
              <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                Export to Pastel
              </h1>
              <p className="text-sm text-[var(--muted)]">
                Generate Inventory Journal CSV — {stockTake?.reference}
              </p>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="card px-4 py-3">
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Accepted Lines</div>
                <div className="text-xl font-bold mt-0.5" style={{ fontFamily: 'var(--font-display)', color: '#22c55e' }}>
                  {stats.totalAccepted}
                </div>
              </div>
              <div className="card px-4 py-3">
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">With Variance</div>
                <div className="text-xl font-bold mt-0.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--warning)' }}>
                  {stats.withVariance}
                </div>
              </div>
              <div className="card px-4 py-3">
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Net Qty Adjustment</div>
                <div className="text-xl font-bold mt-0.5" style={{
                  fontFamily: 'var(--font-display)',
                  color: stats.totalAdjustmentQty < 0 ? 'var(--error)' : stats.totalAdjustmentQty > 0 ? '#22c55e' : 'var(--foreground)',
                }}>
                  {stats.totalAdjustmentQty > 0 ? '+' : ''}{stats.totalAdjustmentQty}
                </div>
              </div>
              <div className="card px-4 py-3">
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Net Value Adjustment</div>
                <div className="text-xl font-bold mt-0.5" style={{
                  fontFamily: 'var(--font-display)',
                  color: stats.totalAdjustmentValue < 0 ? 'var(--error)' : stats.totalAdjustmentValue > 0 ? '#22c55e' : 'var(--foreground)',
                }}>
                  {stats.totalAdjustmentValue < 0 ? '-' : ''}R{Math.abs(stats.totalAdjustmentValue).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Warnings */}
            {stats.totalAccepted === 0 && (
              <div className="card px-4 py-3 border-2" style={{ borderColor: 'var(--error)' }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--error)' }}>
                  <AlertTriangle size={16} />
                  No accepted results to export. Go to Reconcile to accept line items first.
                </div>
              </div>
            )}

            {/* Settings */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Settings size={16} className="text-[var(--muted)]" />
                <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>Export Settings</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider block mb-1">
                    GL Account Code
                  </label>
                  <input
                    type="text"
                    value={glCode}
                    onChange={e => { setGlCode(e.target.value); setPreviewRows([]); }}
                    placeholder="e.g. 2100000"
                    maxLength={7}
                    className="w-full h-9 px-3 rounded-lg border text-sm bg-white font-mono"
                    style={{ borderColor: 'var(--card-border)' }}
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-1">Inventory adjustment GL account (7 digits)</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider block mb-1">
                    Include Zero Variance
                  </label>
                  <div className="flex items-center gap-3 h-9">
                    <button
                      onClick={() => { setIncludeZero(true); setPreviewRows([]); }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                      style={{
                        background: includeZero ? 'var(--primary-light)' : 'transparent',
                        color: includeZero ? 'var(--primary)' : 'var(--muted)',
                        border: `1px solid ${includeZero ? 'var(--primary)' : 'var(--card-border)'}`,
                      }}
                    >
                      Yes — all {stats.totalAccepted} lines
                    </button>
                    <button
                      onClick={() => { setIncludeZero(false); setPreviewRows([]); }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                      style={{
                        background: !includeZero ? 'var(--primary-light)' : 'transparent',
                        color: !includeZero ? 'var(--primary)' : 'var(--muted)',
                        border: `1px solid ${!includeZero ? 'var(--primary)' : 'var(--card-border)'}`,
                      }}
                    >
                      No — only {stats.withVariance} with variance
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mt-1">Pastel ignores zero-qty lines but they serve as a completeness check</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t flex items-center gap-2 text-xs text-[var(--muted)]" style={{ borderColor: 'var(--card-border)' }}>
                <FileSpreadsheet size={14} />
                <span>
                  Store 001 (Main): {stats.store001Count} lines · Store 002 (Quarantine): {stats.store002Count} lines ·
                  Reference: {stockTake?.reference?.replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase()}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePreview}
                disabled={stats.totalAccepted === 0}
                className="h-10 px-5 rounded-lg border text-sm font-semibold flex items-center gap-2 transition-colors hover:bg-slate-50 cursor-pointer disabled:opacity-40"
                style={{ borderColor: 'var(--card-border)' }}
              >
                <FileSpreadsheet size={16} />
                Preview ({rowCount} rows)
              </button>
              <button
                onClick={handleDownload}
                disabled={stats.totalAccepted === 0 || downloading}
                className="h-10 px-5 rounded-lg text-white text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--primary)' }}
              >
                <Download size={16} />
                {downloading ? 'Generating...' : 'Download CSV'}
              </button>
            </div>

            {/* Preview */}
            {previewRows.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--card-border)' }}>
                  <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                    CSV Preview — {previewRows.length} rows
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    Date | Code | Narration | Ref | Qty | Cost | GL | Projects | Store
                  </span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <tbody>
                      {previewRows.slice(0, 100).map((row, i) => {
                        const cols = parseCSVRow(row);
                        const qty = parseFloat(cols[4] || '0');
                        return (
                          <tr
                            key={i}
                            className="border-b hover:bg-slate-50"
                            style={{ borderColor: 'var(--card-border)' }}
                          >
                            <td className="px-2 py-1.5 text-[var(--muted)] w-8 text-right">{i + 1}</td>
                            <td className="px-2 py-1.5 text-[10px] text-[var(--muted)]">{cols[0]}</td>
                            <td className="px-2 py-1.5 font-medium">{cols[1]}</td>
                            <td className="px-2 py-1.5 text-[var(--muted)] max-w-[120px] truncate">{cols[2]}</td>
                            <td className="px-2 py-1.5 text-[var(--muted)]">{cols[3]}</td>
                            <td className="px-2 py-1.5 text-right font-bold" style={{
                              color: qty < 0 ? 'var(--error)' : qty > 0 ? '#22c55e' : 'var(--muted)',
                            }}>
                              {cols[4]}
                            </td>
                            <td className="px-2 py-1.5 text-right text-[var(--muted)]">{cols[5]}</td>
                            <td className="px-2 py-1.5 text-[var(--muted)]">{cols[6]}</td>
                            <td className="px-2 py-1.5 text-center">{cols[8]}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {previewRows.length > 100 && (
                    <div className="p-3 text-center text-xs text-[var(--muted)]">
                      Showing first 100 of {previewRows.length} rows
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Format info */}
            <div className="text-xs text-[var(--muted)] space-y-1">
              <div className="font-semibold">Pastel Import Instructions:</div>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>Open Pastel → Process → Inventory Journals</li>
                <li>Select journal type and create a new batch</li>
                <li>Go to Batch → Import</li>
                <li>Select the downloaded CSV file</li>
                <li>Verify the imported lines and post the batch</li>
              </ol>
              <div className="mt-2 flex items-center gap-1.5">
                <CheckCircle size={12} className="text-green-500" />
                Format: Sage Pastel Partner Inventory Journal (9-column, no header, DD/MM/YYYY dates)
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** Simple CSV row parser — handles quoted fields */
function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) result.push(current.trim());
  return result;
}
