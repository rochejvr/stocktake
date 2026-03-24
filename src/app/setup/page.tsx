'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Upload, Check, AlertTriangle, Loader, RefreshCw, X } from 'lucide-react';
import { buildReference } from '@/lib/constants';
import { startOfToday, setHours } from 'date-fns';

interface ImportedRow {
  partNumber: string;
  description: string;
  qty: number;
  store: '001' | '002';
}

interface ParseResult {
  store001: ImportedRow[];
  store002: ImportedRow[];
  errors: string[];
}

export default function SetupPage() {
  const [year, setYear]       = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [countTime, setCountTime]     = useState('12:00');
  const [recountTime, setRecountTime] = useState('15:00');

  const [file001, setFile001] = useState<File | null>(null);
  const [file002, setFile002] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [alreadyExists, setAlreadyExists] = useState(false);

  const ref = buildReference(year, quarter);

  // Check if reference already exists when year/quarter changes
  useEffect(() => {
    setAlreadyExists(false);
    setSaved(false);
    fetch(`/api/stock-takes/check?reference=${encodeURIComponent(ref)}`)
      .then(r => r.json())
      .then(d => setAlreadyExists(!!d.exists))
      .catch(() => {});
  }, [ref]);

  // Auto-parse whenever files change
  useEffect(() => {
    if (!file001 && !file002) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setParsing(true);
    setParseError(null);
    setPreview(null);

    const formData = new FormData();
    if (file001) formData.append('file001', file001);
    if (file002) formData.append('file002', file002);

    fetch('/api/setup/parse-pastel', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setPreview(data);
      })
      .catch(e => {
        if (!cancelled) setParseError(e.message || 'Failed to parse files');
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });

    return () => { cancelled = true; };
  }, [file001, file002]);

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const today = startOfToday();
      const [ch, cm] = countTime.split(':').map(Number);
      const [rh, rm] = recountTime.split(':').map(Number);
      const countingDeadline = setHours(today, ch);
      countingDeadline.setMinutes(cm);
      const recountDeadline = setHours(today, rh);
      recountDeadline.setMinutes(rm);

      const res = await fetch('/api/stock-takes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: ref,
          name: `${ref} Stock Take`,
          quarter,
          year,
          counting_deadline: countingDeadline.toISOString(),
          recount_deadline:  recountDeadline.toISOString(),
          inventory: preview,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const uniqueParts = preview
    ? new Set([...preview.store001.map(r => r.partNumber), ...preview.store002.map(r => r.partNumber)]).size
    : 0;
  const canSave = !!preview && uniqueParts > 0 && !parsing;

  return (
    <AppShell>
      <div className="p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            Setup Stock Take
          </h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            Import Pastel inventory quantities to initialise or refresh the stock take.
          </p>
        </div>

        {/* Session details */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-semibold mb-4">Session Details</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">Year</label>
              <select className="input" value={year} onChange={e => setYear(+e.target.value)}>
                {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">Quarter</label>
              <select className="input" value={quarter} onChange={e => setQuarter(+e.target.value)}>
                {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 mb-4 inline-flex items-center gap-2">
            <span className="text-[var(--muted)] text-xs">Reference:</span>
            <span className="font-semibold text-[var(--primary)] text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
              {ref}
            </span>
            {alreadyExists && (
              <span className="badge badge-amber text-[10px]">exists — will update</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">Count deadline</label>
              <input type="time" className="input" value={countTime} onChange={e => setCountTime(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">Recount deadline</label>
              <input type="time" className="input" value={recountTime} onChange={e => setRecountTime(e.target.value)} />
            </div>
          </div>
        </div>

        {/* File upload */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-semibold mb-1">Pastel Inventory Files</h2>
          <p className="text-xs text-[var(--muted)] mb-4">
            Files are parsed automatically on selection. Both stores update the master component catalog.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <FileDropZone label="Store 001 — Main"       file={file001} onChange={f => { setFile001(f); setSaved(false); }} />
            <FileDropZone label="Store 002 — Quarantine" file={file002} onChange={f => { setFile002(f); setSaved(false); }} />
          </div>

          {/* Parse status */}
          {parsing && (
            <div className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
              <Loader size={14} className="animate-spin" /> Parsing files…
            </div>
          )}

          {parseError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle size={14} /> {parseError}
            </div>
          )}

          {preview && !parsing && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ParsedStoreStat store="001" count={preview.store001.length} sample={preview.store001[0]} />
              <ParsedStoreStat store="002" count={preview.store002.length} sample={preview.store002[0]} />
              {preview.errors.length > 0 && (
                <div className="col-span-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 space-y-0.5">
                  {preview.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {saved ? (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 flex items-center gap-2">
            <Check size={16} />
            {alreadyExists
              ? <><strong>{ref}</strong> inventory updated — {uniqueParts} parts loaded, component catalog refreshed.</>
              : <><strong>{ref}</strong> created — {uniqueParts} parts loaded. Head to Checklist next.</>
            }
          </div>
        ) : (
          <button className="btn-primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving
              ? <Loader size={14} className="animate-spin" />
              : alreadyExists ? <RefreshCw size={14} /> : <Check size={14} />
            }
            {saving
              ? (alreadyExists ? 'Updating…' : 'Creating…')
              : !preview || parsing
                ? 'Waiting for files…'
                : alreadyExists ? `Update ${ref} — ${uniqueParts} parts` : `Create ${ref} — ${uniqueParts} parts`
            }
          </button>
        )}
      </div>
    </AppShell>
  );
}

function ParsedStoreStat({ store, count, sample }: {
  store: string;
  count: number;
  sample?: { partNumber: string; description: string; qty: number };
}) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-[var(--card-border)]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[var(--muted)]">Store {store}</span>
        <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>{count}</span>
      </div>
      <div className="text-[10px] text-[var(--muted)]">parts parsed</div>
      {sample && (
        <div className="text-[10px] font-mono text-[var(--muted-light)] mt-1 truncate">
          {sample.partNumber} · {sample.description}
        </div>
      )}
    </div>
  );
}

function FileDropZone({ label, file, onChange }: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className="block cursor-pointer">
      <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        file ? 'border-green-300 bg-green-50' : 'border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-blue-50'
      }`}>
        {file ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Check size={16} className="text-green-600 flex-shrink-0" />
              <div className="text-left min-w-0">
                <div className="text-xs font-medium text-green-700 truncate">{file.name}</div>
                <div className="text-[10px] text-green-600">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>
            <button
              type="button"
              onClick={e => { e.preventDefault(); onChange(null); }}
              className="text-green-400 hover:text-green-600 flex-shrink-0 ml-2"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <Upload size={20} className="mx-auto mb-2 text-[var(--muted-light)]" />
            <div className="text-xs font-medium text-[var(--foreground)]">{label}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">Click to select CSV or Excel</div>
          </>
        )}
      </div>
      <input type="file" accept=".csv,.xlsx,.xls" className="sr-only"
        onChange={e => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}
