'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ScanLine, Package, ArrowLeft, Check, X, Link2, Send, Trash2, Camera, Keyboard, Pencil, Warehouse, Delete } from 'lucide-react';
import { CameraScanner } from '@/components/scan/CameraScanner';
import { DiagnosticScanner } from '@/components/scan/DiagnosticScanner';
import type { StockTake, ComponentChain } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

type Stage = 'loading' | 'no-stock-take' | 'start' | 'scanning' | 'submitted';

interface SessionInfo {
  id: string;
  stockTakeId: string;
  userName: string;
  countNumber: 1 | 2;
  zone: string | null;
}

interface ScannedItem {
  id: string;
  barcode: string;
  description: string;
  qty: number;
  scannedAt: string;
  storeCode: string;
  chained?: boolean;
}

const STORES = [
  { code: '001', label: 'Main Store' },
  { code: '002', label: 'Quarantine' },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_KEY = 'stocktake-scan-session';

function loadSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(session: SessionInfo) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function vibrate() {
  try { navigator.vibrate?.(50); } catch { /* noop */ }
}

function fetchWithTimeout(url: string, opts?: RequestInit, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function ScanPage() {
  const [stage, setStage] = useState<Stage>('loading');
  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [chains, setChains] = useState<ComponentChain[]>([]);
  const [items, setItems] = useState<ScannedItem[]>([]);
  // Recount mode: set of "barcode|store_code" keys flagged for recount
  const [recountParts, setRecountParts] = useState<Set<string> | null>(null);

  // Start form (PIN login)
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [countNumber, setCountNumber] = useState<1 | 2>(1);
  const [storeCode, setStoreCode] = useState('001');
  const [starting, setStarting] = useState(false);

  // Scanner — camera requires HTTPS, default set in useEffect
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('manual');
  const [isHttps, setIsHttps] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pending, setPending] = useState<{ barcode: string; description: string } | null>(null);
  const [qty, setQty] = useState('1');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');

  const barcodeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const editQtyRef = useRef<HTMLInputElement>(null);

  // ── Diagnostic mode ──────────────────────────────────────────────────────
  const [diagMode, setDiagMode] = useState(false);

  // ── Init: load stock take + check for existing session ───────────────────

  useEffect(() => {
    const https = window.location.protocol === 'https:';
    setIsHttps(https);
    if (https) setScanMode('camera');

    // Safety net: never spin for more than 10 seconds
    const safetyTimer = setTimeout(() => {
      setStage(prev => prev === 'loading' ? 'start' : prev);
    }, 10000);

    async function init() {
      try {
        const res = await fetchWithTimeout('/api/stock-takes/active');
        const data = await res.json();
        const st: StockTake | null = data?.stockTake ?? null;

        if (!st || (st.status !== 'counting' && st.status !== 'recount')) {
          setStage('no-stock-take');
          return;
        }

        setStockTake(st);

        // Auto-set Count 2 when in recount mode + load flagged parts
        if (st.status === 'recount') {
          setCountNumber(2);
          fetchWithTimeout(`/api/count-results?stockTakeId=${st.id}&filter=flagged`)
            .then(r => r.json())
            .then((data: Array<{ part_number: string; store_code: string }>) => {
              if (Array.isArray(data)) {
                setRecountParts(new Set(data.map(r => `${r.part_number}|${r.store_code}`)));
              }
            })
            .catch(() => {});
        }

        // Load component chains (non-blocking — don't let it hold up the page)
        fetchWithTimeout('/api/bom/chains')
          .then(r => r.json())
          .then(d => setChains(Array.isArray(d) ? d : []))
          .catch(() => {});

        // Check for existing session in localStorage
        const saved = loadSession();
        if (saved && saved.stockTakeId === st.id) {
          setSession(saved);
          setName(saved.userName);
          // Show scanning UI immediately
          setStage('scanning');
          // Load existing records in background (non-blocking)
          fetchWithTimeout(`/api/scan-sessions/${saved.id}/records`)
            .then(r => r.ok ? r.json() : [])
            .then(async (records: Array<{ id: string; barcode: string; quantity: number; scanned_at: string; store_code?: string }>) => {
              if (!Array.isArray(records) || records.length === 0) return;
              setItems(records.map(r => ({
                id: r.id,
                barcode: r.barcode,
                description: '...',
                qty: r.quantity,
                scannedAt: r.scanned_at,
                storeCode: r.store_code || '001',
              })));
              // Fill descriptions in background
              const uniqueBarcodes: string[] = [...new Set(records.map(r => r.barcode))];
              const descMap: Record<string, string> = {};
              await Promise.all(uniqueBarcodes.map(async (bc) => {
                try {
                  const lr = await fetchWithTimeout(`/api/scan/lookup?barcode=${encodeURIComponent(bc)}&stockTakeId=${st.id}`);
                  const ld = await lr.json();
                  descMap[bc] = ld.found ? ld.description : bc;
                } catch { descMap[bc] = bc; }
              }));
              setItems(prev => prev.map(item => ({
                ...item,
                description: descMap[item.barcode] || item.barcode,
              })));
            })
            .catch(() => {});
        } else {
          clearSession();
          setStage('start');
        }
      } catch {
        // If fetch timed out or failed, show login form (not a dead spinner)
        setStage('start');
        setError('Could not reach server — try again');
      }
    }
    init();

    return () => clearTimeout(safetyTimer);
  }, []);

  // ── Auto-focus barcode input when in scanning mode ───────────────────────

  useEffect(() => {
    if (stage === 'scanning' && !pending) {
      const t = setTimeout(() => barcodeRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [stage, pending, items.length]);

  // ── Auto-focus qty input when pending ────────────────────────────────────

  useEffect(() => {
    if (pending) {
      // Delay for iOS to register the new input, then focus to trigger keyboard
      const t = setTimeout(() => {
        if (qtyRef.current) {
          qtyRef.current.focus();
          // iOS needs a click() to reliably show the keyboard
          qtyRef.current.click();
        }
      }, 200);
      return () => clearTimeout(t);
    }
  }, [pending]);

  // ── Flash effect ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [flash]);

  // ── Start session ────────────────────────────────────────────────────────

  const handleStartSession = useCallback(async () => {
    if (!stockTake || !name.trim() || !pin.trim()) return;
    setStarting(true);
    setError(null);

    try {
      const res = await fetch('/api/counters/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_take_id: stockTake.id,
          name: name.trim(),
          pin: pin.trim(),
          count_number: countNumber,
          device_info: navigator.userAgent,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      const sess = data.session;
      const sessionInfo: SessionInfo = {
        id: sess.id,
        stockTakeId: stockTake.id,
        userName: sess.user_name,
        countNumber: sess.count_number,
        zone: sess.zone || null,
      };

      setSession(sessionInfo);
      saveSession(sessionInfo);

      // If resuming, load existing records
      if (data.resumed && data.records?.length > 0) {
        const records = data.records;
        const uniqueBarcodes: string[] = [...new Set(records.map((r: { barcode: string }) => r.barcode) as string[])];
        const descMap: Record<string, string> = {};
        await Promise.all(uniqueBarcodes.map(async (bc: string) => {
          try {
            const lookupRes = await fetch(`/api/scan/lookup?barcode=${encodeURIComponent(bc)}&stockTakeId=${stockTake.id}`);
            const lookupData = await lookupRes.json();
            descMap[bc] = lookupData.found ? lookupData.description : 'Unknown part';
          } catch { descMap[bc] = 'Unknown part'; }
        }));
        setItems(records.map((r: { id: string; barcode: string; quantity: number; scanned_at: string; store_code?: string }) => ({
          id: r.id,
          barcode: r.barcode,
          description: descMap[r.barcode] || 'Unknown part',
          qty: r.quantity,
          scannedAt: r.scanned_at,
          storeCode: r.store_code || '001',
        })));
      }

      setStage('scanning');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setStarting(false);
    }
  }, [stockTake, name, pin, countNumber]);

  // ── Barcode scanned (Enter pressed) ──────────────────────────────────────

  // Unified scan handler — checks diagModeRef to decide behavior
  const handleScan = useCallback(async (code: string) => {
    const barcode = code.trim().toUpperCase();
    if (!barcode || !stockTake) return;

    setBarcodeInput('');
    setError(null);

    try {
      const res = await fetch(
        `/api/scan/lookup?barcode=${encodeURIComponent(barcode)}&stockTakeId=${stockTake.id}`
      );
      const data = await res.json();

      if (!data.valid) {
        setError(`"${barcode}" is not a recognised Pastel part or BOM WIP code`);
        vibrate();
        return;
      }

      // Recount mode: warn if part is not flagged for recount in this store
      if (recountParts && recountParts.size > 0) {
        const key = `${barcode}|${storeCode}`;
        if (!recountParts.has(key)) {
          const scanAnyway = confirm(
            `"${barcode}" is not flagged for recount in ${storeCode === '001' ? 'Main Store' : 'Quarantine'}.\n\nScan anyway?`
          );
          if (!scanAnyway) return;
        }
      }

      setPending({
        barcode,
        description: data.description || barcode,
      });
      setQty('');
    } catch {
      setError('Barcode lookup failed — check your connection');
    }
  }, [stockTake]);

  // ── Confirm quantity ─────────────────────────────────────────────────────

  const handleConfirmQty = useCallback(async () => {
    if (!pending || !session || !stockTake) return;

    const quantity = qty.trim() === '' ? 1 : parseInt(qty, 10);
    if (isNaN(quantity) || quantity < 0) {
      setError('Enter a valid quantity');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Build records: primary + any chain credits
      const records: Array<{
        barcode: string;
        quantity: number;
        stock_take_id: string;
        user_name: string;
        store_code: string;
        chained_from?: string | null;
      }> = [
        {
          barcode: pending.barcode,
          quantity,
          stock_take_id: stockTake.id,
          user_name: session.userName,
          store_code: storeCode,
          chained_from: null,
        },
      ];

      // Check for component chains (one scanned code can credit multiple items)
      // credit_qty is a multiplier: scanned 148 × credit_qty 1 = credit 148
      const chainMatches = chains.filter(c => c.scanned_code === pending.barcode);
      for (const chain of chainMatches) {
        records.push({
          barcode: chain.also_credit_code,
          quantity: quantity * (chain.credit_qty ?? 1),
          stock_take_id: stockTake.id,
          user_name: session.userName,
          store_code: storeCode,
          chained_from: pending.barcode,
        });
      }

      const res = await fetch(`/api/scan-sessions/${session.id}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
      });

      if (!res.ok) throw new Error('Failed to save');
      const savedRecords: Array<{ id: string; barcode: string }> = await res.json();

      // Add to local list with record IDs from the database
      const now = new Date().toISOString();
      const primaryRecord = savedRecords.find(r => r.barcode === pending.barcode);

      const newItems: ScannedItem[] = [
        { id: primaryRecord?.id || '', barcode: pending.barcode, description: pending.description, qty: quantity, scannedAt: now, storeCode },
      ];
      for (const chain of chainMatches) {
        const chainRecord = savedRecords.find(r => r.barcode === chain.also_credit_code);
        if (chainRecord) {
          newItems.push({
            id: chainRecord.id,
            barcode: chain.also_credit_code,
            description: `Chain from ${pending.barcode}`,
            qty: quantity * (chain.credit_qty ?? 1),
            scannedAt: now,
            storeCode,
            chained: true,
          });
        }
      }

      setItems(prev => [...newItems, ...prev]);
      setPending(null);
      setFlash('success');
      vibrate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save scan');
      setFlash('error');
    } finally {
      setSaving(false);
    }
  }, [pending, session, stockTake, qty, chains]);

  // ── Cancel pending ───────────────────────────────────────────────────────

  const handleCancelPending = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  // ── Edit scan quantity ─────────────────────────────────────────────────

  const handleStartEdit = useCallback((item: ScannedItem) => {
    setEditingId(item.id);
    setEditQty(String(item.qty));
    setTimeout(() => {
      editQtyRef.current?.focus();
      editQtyRef.current?.select();
    }, 100);
  }, []);

  const handleSaveEdit = useCallback(async (itemId: string) => {
    const newQty = parseInt(editQty, 10);
    if (isNaN(newQty) || newQty < 0) return;

    // Optimistic: update UI immediately
    const oldQty = items.find(i => i.id === itemId)?.qty;
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: newQty } : i));
    setEditingId(null);
    vibrate();

    try {
      const res = await fetch(`/api/scan-records/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      });
      if (!res.ok) throw new Error('Failed to update');
    } catch {
      // Rollback on failure
      if (oldQty !== undefined) {
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: oldQty } : i));
      }
      setError('Failed to update quantity');
    }
  }, [editQty, items]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  // ── Delete scan record ─────────────────────────────────────────────────

  const handleDelete = useCallback(async (itemId: string) => {
    if (!confirm('Delete this scan?')) return;

    // Optimistic: remove from UI immediately
    const removed = items.find(i => i.id === itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    vibrate();

    try {
      const res = await fetch(`/api/scan-records/${itemId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    } catch {
      // Rollback on failure
      if (removed) setItems(prev => [removed, ...prev]);
      setError('Failed to delete scan');
    }
  }, [items]);

  // ── Undo last scan (delete most recent) ────────────────────────────────

  const handleUndoLast = useCallback(async () => {
    if (items.length === 0) return;
    const latest = items[0];
    if (!confirm(`Remove last scan (${latest.barcode})?`)) return;

    try {
      const res = await fetch(`/api/scan-records/${latest.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setItems(prev => prev.slice(1));
      vibrate();
    } catch {
      setError('Failed to undo last scan');
    }
  }, [items]);

  // ── Submit session ───────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!session) return;
    setError(null);

    try {
      const res = await fetch(`/api/scan-sessions/${session.id}/submit`, {
        method: 'PUT',
      });
      if (!res.ok) throw new Error('Failed to submit');

      clearSession();
      setStage('submitted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit session');
    }
  }, [session]);

  // ── Render ─────────────────────────────────────────────────────────────

  // Loading
  if (stage === 'loading') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--background)]">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // No active stock take
  if (stage === 'no-stock-take') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--background)] p-6">
        <div className="text-center">
          <Package size={40} className="mx-auto mb-4 text-[var(--muted-light)]" />
          <h1 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            No Active Count
          </h1>
          <p className="text-sm text-[var(--muted)]">
            There is no stock take currently in counting mode.
            Ask your supervisor to start the count.
          </p>
        </div>
      </div>
    );
  }

  // Session start form
  if (stage === 'start') {
    return (
      <div className="min-h-dvh bg-[var(--background)] p-6">
        <div className="max-w-sm mx-auto pt-12">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--primary-light)' }}>
              <ScanLine size={24} style={{ color: 'var(--primary)' }} />
            </div>
            <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {stockTake?.status === 'recount' ? 'Recount' : 'Start Counting'}
            </h1>
            {stockTake?.status === 'recount' && (
              <div className="mt-2 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold inline-block">
                Count 2 — Recount flagged items
              </div>
            )}
            <p className="text-sm text-[var(--muted)] mt-1">
              {stockTake?.reference} — {stockTake?.name}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
                Your Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. John"
                autoFocus
                className="w-full h-12 px-4 rounded-lg border text-base bg-white"
                style={{ borderColor: 'var(--card-border)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
                PIN
              </label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4-digit PIN"
                className="w-full h-12 px-4 rounded-lg border text-base bg-white text-center tracking-[0.5em] font-mono font-bold"
                style={{ borderColor: 'var(--card-border)' }}
                onKeyDown={e => { if (e.key === 'Enter' && name.trim() && pin.length === 4) handleStartSession(); }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
                Count Number
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([1, 2] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setCountNumber(n)}
                    className="h-12 rounded-lg border text-sm font-semibold transition-all"
                    style={{
                      borderColor: countNumber === n ? 'var(--primary)' : 'var(--card-border)',
                      background: countNumber === n ? 'var(--primary-light)' : 'white',
                      color: countNumber === n ? 'var(--primary)' : 'var(--foreground)',
                    }}
                  >
                    Count {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
                Store
              </label>
              <div className="grid grid-cols-2 gap-2">
                {STORES.map(s => (
                  <button
                    key={s.code}
                    onClick={() => setStoreCode(s.code)}
                    className="h-12 rounded-lg border text-sm font-semibold transition-all"
                    style={{
                      borderColor: storeCode === s.code ? 'var(--primary)' : 'var(--card-border)',
                      background: storeCode === s.code ? 'var(--primary-light)' : 'white',
                      color: storeCode === s.code ? 'var(--primary)' : 'var(--foreground)',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-sm text-[var(--error)] bg-[var(--error-light)] px-4 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            <button
              onClick={handleStartSession}
              disabled={!name.trim() || pin.length !== 4 || starting}
              className="w-full h-14 rounded-xl text-white font-bold text-base transition-all disabled:opacity-40"
              style={{ background: 'var(--primary)', fontFamily: 'var(--font-display)' }}
            >
              {starting ? 'Logging in...' : 'Start Scanning'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Submitted
  if (stage === 'submitted') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--background)] p-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-green-100">
            <Check size={32} className="text-green-600" />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Session Submitted
          </h1>
          <p className="text-sm text-[var(--muted)] mb-1">
            {items.length} item{items.length !== 1 ? 's' : ''} recorded
          </p>
          <p className="text-sm text-[var(--muted)] mb-8">
            Thank you, {session?.userName}!
          </p>
          <button
            onClick={async () => {
              clearSession();
              setSession(null);
              setItems([]);
              setPending(null);
              setPin('');
              // Re-fetch stock take status (may have moved to recount)
              try {
                const res = await fetchWithTimeout('/api/stock-takes/active');
                const data = await res.json();
                const st: StockTake | null = data?.stockTake ?? null;
                if (st) {
                  setStockTake(st);
                  if (st.status === 'recount') setCountNumber(2);
                }
              } catch { /* continue with existing state */ }
              setStage('start');
            }}
            className="px-6 h-12 rounded-xl text-white font-semibold text-sm"
            style={{ background: 'var(--primary)' }}
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // ── Main scanning view ────────────────────────────────────────────────

  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div className={`min-h-dvh flex flex-col bg-[var(--background)] transition-colors duration-300 ${
      flash === 'success' ? 'bg-green-50' : flash === 'error' ? 'bg-red-50' : ''
    }`}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 bg-white border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <ScanLine size={18} style={{ color: 'var(--primary)' }} className="flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
                {session?.userName} — Count {session?.countNumber}
              </div>
              <div className="text-[11px] text-[var(--muted)] truncate">
                {stockTake?.reference}
                {session?.zone ? ` · ${session.zone}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Store toggle */}
            <button
              onClick={() => setStoreCode(prev => prev === '001' ? '002' : '001')}
              className="flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold transition-all"
              style={{
                borderColor: storeCode === '002' ? 'var(--warning)' : 'var(--primary)',
                background: storeCode === '002' ? '#fef3c7' : 'var(--primary-light)',
                color: storeCode === '002' ? '#b45309' : 'var(--primary)',
              }}
            >
              <Warehouse size={12} />
              {storeCode === '001' ? 'Main' : 'Quarantine'}
            </button>
            <div className="text-right">
              <div className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {items.filter(i => !i.chained).length}
              </div>
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">scans</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mode toggle + scanner/input + qty confirmation */}
      <div className="flex-shrink-0 p-4 space-y-3">
        {/* Mode toggle */}
        {!pending && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100">
            <button
              onClick={() => {
                if (!isHttps) {
                  alert('Camera requires HTTPS. In production (Vercel) this works automatically. For local dev, use Manual mode.');
                  return;
                }
                setScanMode('camera');
              }}
              className="h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{
                background: scanMode === 'camera' ? 'white' : 'transparent',
                color: scanMode === 'camera' ? 'var(--primary)' : 'var(--muted)',
                boxShadow: scanMode === 'camera' ? 'var(--shadow-sm)' : 'none',
                opacity: !isHttps ? 0.5 : 1,
              }}
            >
              <Camera size={14} /> Camera
            </button>
            <button
              onClick={() => {
                setScanMode('manual');
                setTimeout(() => barcodeRef.current?.focus(), 100);
              }}
              className="h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{
                background: scanMode === 'manual' ? 'white' : 'transparent',
                color: scanMode === 'manual' ? 'var(--primary)' : 'var(--muted)',
                boxShadow: scanMode === 'manual' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <Keyboard size={14} /> Manual
            </button>
          </div>
        )}

        {/* Camera scanner — always visible when in camera mode */}
        {scanMode === 'camera' && !diagMode && (
          <div className="relative">
            <CameraScanner
              active={stage === 'scanning'}
              onScan={handleScan}
              onCancel={() => setScanMode('manual')}
            />

            {/* Qty overlay — slides up over camera when barcode scanned */}
            {pending && (
              <div
                className="absolute inset-x-0 bottom-0 rounded-b-xl overflow-hidden"
                style={{
                  background: 'rgba(0,0,0,0.85)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  animation: 'slideUp 0.2s ease-out',
                }}
              >
                <div className="px-3 pt-3 pb-3">
                  {/* Part info + qty display */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-bold text-white tracking-wide truncate">
                        {pending.barcode}
                      </div>
                      <div className="text-[11px] text-white/40 truncate">{pending.description}</div>
                    </div>
                    <div className="text-3xl font-bold text-white ml-3 min-w-[3ch] text-right" style={{ fontFamily: 'var(--font-display)' }}>
                      {qty || <span className="text-white/20">0</span>}
                    </div>
                  </div>

                  {/* Numpad: 1-5, 6-0 */}
                  <div className="grid grid-cols-5 gap-1.5 mb-2">
                    {[1,2,3,4,5,6,7,8,9,0].map(n => (
                      <button
                        key={n}
                        onClick={() => setQty(prev => prev === '0' ? String(n) : prev + String(n))}
                        className="h-11 rounded-lg text-lg font-bold transition-all active:scale-95"
                        style={{
                          background: 'rgba(255,255,255,0.12)',
                          color: 'rgba(255,255,255,0.85)',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  {/* Actions: Cancel / Backspace / Confirm */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5">
                    <button
                      onClick={handleCancelPending}
                      className="h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                      style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}
                    >
                      <X size={13} /> Cancel
                    </button>
                    <button
                      onClick={() => setQty(prev => prev.slice(0, -1))}
                      className="h-10 w-12 rounded-lg flex items-center justify-center transition-all"
                      style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
                    >
                      <Delete size={18} />
                    </button>
                    <button
                      onClick={handleConfirmQty}
                      disabled={saving || qty.trim() === ''}
                      className="h-10 rounded-lg text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-30 transition-all"
                      style={{ background: 'var(--success)', color: 'white' }}
                    >
                      <Check size={13} /> {saving ? '...' : `Confirm ${qty || ''}`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!pending && (
              <button
                onClick={() => setDiagMode(true)}
                className="mt-2 text-[11px] font-medium px-2 py-1 rounded"
                style={{ background: 'var(--card-bg)', color: 'var(--muted)', border: '1px solid var(--card-border)' }}
              >
                Diagnostic Mode
              </button>
            )}
          </div>
        )}

        {/* Diagnostic scanner — multi-engine comparison */}
        {scanMode === 'camera' && diagMode && stockTake && (
          <DiagnosticScanner
            active={stage === 'scanning' && !pending}
            stockTakeId={stockTake.id}
            onExit={() => setDiagMode(false)}
          />
        )}

        {/* Manual text input */}
        {scanMode === 'manual' && !pending && (
          <div>
            <label className="block text-[10px] font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
              Type barcode and press Enter
            </label>
            <input
              ref={barcodeRef}
              type="text"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && barcodeInput.trim()) {
                  handleScan(barcodeInput);
                }
              }}
              placeholder="Type or scan barcode..."
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full h-14 px-4 rounded-xl border-2 text-lg font-mono font-medium bg-white text-center tracking-wider"
              style={{ borderColor: 'var(--primary)', outline: 'none' }}
            />
          </div>
        )}

        {/* Manual mode qty confirmation */}
        {scanMode === 'manual' && pending && (
          <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--card-bg)', border: '2px solid var(--primary)' }}>
            {/* Part info + qty display */}
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold tracking-wide" style={{ color: 'var(--primary)' }}>
                  {pending.barcode}
                </div>
                <div className="text-[11px] text-[var(--muted)] truncate">{pending.description}</div>
              </div>
              <div className="text-3xl font-bold ml-3 min-w-[3ch] text-right" style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}>
                {qty || <span style={{ color: 'var(--card-border)' }}>0</span>}
              </div>
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-5 gap-1.5">
              {[1,2,3,4,5,6,7,8,9,0].map(n => (
                <button
                  key={n}
                  onClick={() => setQty(prev => prev === '0' ? String(n) : prev + String(n))}
                  className="h-11 rounded-lg text-base font-bold transition-all active:scale-95"
                  style={{
                    background: 'white',
                    color: 'var(--foreground)',
                    border: '1px solid var(--card-border)',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5">
              <button
                onClick={handleCancelPending}
                className="h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
                style={{ border: '1px solid var(--card-border)' }}
              >
                <X size={13} /> Cancel
              </button>
              <button
                onClick={() => setQty(prev => prev.slice(0, -1))}
                className="h-10 w-12 rounded-lg flex items-center justify-center"
                style={{ border: '1px solid var(--card-border)', color: 'var(--muted)' }}
              >
                <Delete size={18} />
              </button>
              <button
                onClick={handleConfirmQty}
                disabled={saving || qty.trim() === ''}
                className="h-10 rounded-lg text-white text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-30"
                style={{ background: 'var(--success)' }}
              >
                <Check size={13} /> {saving ? '...' : `Confirm ${qty || ''}`}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-2 text-sm text-[var(--error)] bg-[var(--error-light)] px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}
      </div>

      {/* Scanned items list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {items.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                {items.filter(i => !i.chained).length} scanned · {totalQty} total qty
              </span>
              <button
                onClick={handleUndoLast}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--error)] flex items-center gap-1 transition-colors"
              >
                <Trash2 size={12} /> Undo last
              </button>
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <div
                  key={`${item.barcode}-${item.scannedAt}-${i}`}
                  className="card px-3 py-2.5 flex items-center gap-3"
                  style={item.chained ? { opacity: 0.7 } : undefined}
                >
                  {item.chained ? (
                    <Link2 size={14} className="text-[var(--muted-light)] flex-shrink-0" />
                  ) : (
                    <Check size={14} className="text-green-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs font-medium truncate">{item.barcode}</div>
                    <div className="text-[11px] text-[var(--muted)] truncate">
                      <span className={`inline-block text-[9px] font-bold px-1 py-px rounded mr-1 ${
                        item.storeCode === '002' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {item.storeCode === '002' ? 'Q' : 'M'}
                      </span>
                      {item.description}
                    </div>
                  </div>

                  {editingId === item.id ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        ref={editQtyRef}
                        type="number"
                        inputMode="numeric"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(item.id);
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="w-14 text-center text-sm font-bold rounded-md border px-1 py-0.5"
                        style={{ borderColor: 'var(--card-border)', fontFamily: 'var(--font-display)' }}
                        min={0}
                      />
                      <button
                        onClick={() => handleSaveEdit(item.id)}
                        className="p-1 rounded-md text-green-600 hover:bg-green-50 active:bg-green-100"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1 rounded-md text-[var(--muted)] hover:bg-gray-100 active:bg-gray-200"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="text-sm font-bold mr-1" style={{ fontFamily: 'var(--font-display)' }}>
                        {item.qty}
                      </div>
                      <button
                        onClick={() => handleStartEdit(item)}
                        className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--card-hover)] active:bg-gray-200 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--error)] hover:bg-red-50 active:bg-red-100 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {items.length === 0 && !pending && (
          <div className="text-center py-12 text-[var(--muted-light)]">
            <ScanLine size={32} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm">Scan your first item</div>
          </div>
        )}
      </div>

      {/* Submit footer */}
      {items.length > 0 && !pending && (
        <div className="flex-shrink-0 p-4 bg-white border-t" style={{ borderColor: 'var(--card-border)' }}>
          <button
            onClick={handleSubmit}
            className="w-full h-14 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-all"
            style={{ background: 'var(--primary)', fontFamily: 'var(--font-display)' }}
          >
            <Send size={18} /> Submit Session
          </button>
        </div>
      )}
    </div>
  );
}
