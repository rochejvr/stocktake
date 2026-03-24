'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Upload, FileSpreadsheet, Check, AlertTriangle, Loader } from 'lucide-react';
import { buildReference } from '@/lib/constants';
import { format, addHours, startOfToday, setHours } from 'date-fns';

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
  const [countTime, setCountTime]   = useState('12:00');
  const [recountTime, setRecountTime] = useState('15:00');

  const [file001, setFile001] = useState<File | null>(null);
  const [file002, setFile002] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const ref = buildReference(year, quarter);

  async function handlePreview() {
    if (!file001 && !file002) return;
    setParsing(true);
    setError(null);
    try {
      const formData = new FormData();
      if (file001) formData.append('file001', file001);
      if (file002) formData.append('file002', file002);
      const res = await fetch('/api/setup/parse-pastel', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      setPreview(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to parse files');
    } finally {
      setParsing(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const today = startOfToday();
      const [ch, cm] = countTime.split(':').map(Number);
      const [rh, rm] = recountTime.split(':').map(Number);
      const countingDeadline  = setHours(today, ch);
      countingDeadline.setMinutes(cm);
      const recountDeadline   = setHours(today, rh);
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
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create stock take');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            Setup New Stock Take
          </h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            Import Pastel inventory quantities and configure the count session.
          </p>
        </div>

        {/* Reference + timing */}
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

        {/* File imports */}
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-semibold mb-1">Import Pastel Quantities</h2>
          <p className="text-xs text-[var(--muted)] mb-4">
            Export stock quantities from Pastel for both stores and upload the files here.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <FileDropZone
              label="Store 001 — Main"
              file={file001}
              onChange={setFile001}
              accept=".csv,.xlsx,.xls"
            />
            <FileDropZone
              label="Store 002 — Quarantine"
              file={file002}
              onChange={setFile002}
              accept=".csv,.xlsx,.xls"
            />
          </div>

          {(file001 || file002) && !preview && (
            <button
              className="btn-secondary mt-4"
              onClick={handlePreview}
              disabled={parsing}
            >
              {parsing ? <Loader size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
              {parsing ? 'Parsing…' : 'Preview Import'}
            </button>
          )}
        </div>

        {/* Preview */}
        {preview && (
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold mb-3">Import Preview</h2>
            {preview.errors.length > 0 && (
              <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                {preview.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-lg bg-slate-50">
                <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                  {preview.store001.length}
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">parts · Store 001</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-slate-50">
                <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                  {preview.store002.length}
                </div>
                <div className="text-xs text-[var(--muted)] mt-1">parts · Store 002</div>
              </div>
            </div>

            {/* Sample rows */}
            {preview.store001.slice(0, 3).map((r, i) => (
              <div key={i} className="mt-2 text-xs text-[var(--muted)] font-mono">
                {r.partNumber} · {r.description} · qty {r.qty}
              </div>
            ))}
            {preview.store001.length > 3 && (
              <div className="text-xs text-[var(--muted)] mt-1">
                +{preview.store001.length - 3} more…
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {saved ? (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 flex items-center gap-2">
            <Check size={16} /> Stock take <strong>{ref}</strong> created. Head to Checklist to continue.
          </div>
        ) : (
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={saving || (!file001 && !file002)}
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Creating…' : `Create ${ref}`}
          </button>
        )}
      </div>
    </AppShell>
  );
}

function FileDropZone({ label, file, onChange, accept }: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  accept: string;
}) {
  return (
    <label className="block cursor-pointer">
      <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        file ? 'border-green-300 bg-green-50' : 'border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-blue-50'
      }`}>
        {file ? (
          <>
            <Check size={20} className="mx-auto mb-2 text-green-600" />
            <div className="text-xs font-medium text-green-700 truncate">{file.name}</div>
            <div className="text-[10px] text-green-600 mt-0.5">{(file.size / 1024).toFixed(0)} KB</div>
          </>
        ) : (
          <>
            <Upload size={20} className="mx-auto mb-2 text-[var(--muted-light)]" />
            <div className="text-xs font-medium text-[var(--foreground)]">{label}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5">CSV or Excel</div>
          </>
        )}
      </div>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={e => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
