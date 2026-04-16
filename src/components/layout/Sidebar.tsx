'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardList, Package, GitBranch, ScanLine,
  BarChart3, FileDown, Settings, ChevronRight, Database, X,
} from 'lucide-react';

const NAV = [
  { href: '/',            icon: BarChart3,     label: 'Overview' },
  { href: '/setup',       icon: Settings,      label: 'Setup' },
  { href: '/checklist',   icon: ClipboardList, label: 'Checklist' },
  { href: '/bom',         icon: GitBranch,     label: 'BOM Mapping' },
  { href: '/catalog',     icon: Database,       label: 'Catalog' },
  { href: '/count',       icon: ScanLine,      label: 'Live Count' },
  { href: '/reconcile',   icon: Package,       label: 'Reconcile' },
  { href: '/export',      icon: FileDown,      label: 'Export' },
];

const EXPANDED_W = 224;
const COLLAPSED_W = 56;

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [stockTakeRef, setStockTakeRef] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);

  // Fetch active stock take directly — consistent across all pages
  useEffect(() => {
    fetch('/api/stock-takes/active')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.stockTake) {
          setStockTakeRef(data.stockTake.reference || null);
          setStatus(data.stockTake.status || null);
        } else {
          setStockTakeRef(null);
          setStatus(null);
        }
      })
      .catch(() => { /* ignore */ });
  }, [pathname]); // re-fetch on navigation to stay current

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{
        background: 'var(--sidebar)',
        height: '100vh',
        width: expanded ? EXPANDED_W : COLLAPSED_W,
        transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo + Info block — fixed height to prevent nav jumping */}
      <div className="border-b border-white/10">
        {/* Logo row */}
        <div className="px-3 py-3 flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ background: 'var(--primary)', fontFamily: 'var(--font-display)' }}
          >
            ST
          </div>
          <div className="overflow-hidden whitespace-nowrap" style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms' }}>
            <div className="text-white font-semibold text-sm" style={{ fontFamily: 'var(--font-display)' }}>
              Stock Take
            </div>
            <div className="text-white/40 text-xs">Xavant Technology</div>
          </div>
        </div>

        {/* Active stock take info — always same height, content fades */}
        <div className="px-3 pb-3" style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms', pointerEvents: expanded ? 'auto' : 'none' }}>
          <div className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10" style={{ minHeight: 44 }}>
            {stockTakeRef ? (
              <>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Active</div>
                <div className="text-white text-xs font-medium mt-0.5 whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)' }}>
                  {stockTakeRef}
                </div>
                {status && <StatusDot status={status} />}
              </>
            ) : (
              <div className="text-white/20 text-[10px] uppercase tracking-wider pt-1 whitespace-nowrap">No active stock take</div>
            )}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center text-sm transition-colors group relative"
              style={{
                color: active ? 'white' : 'rgba(255,255,255,0.5)',
                padding: '10px 12px 10px 18px',
              }}
              title={expanded ? undefined : label}
            >
              {/* Active indicator — left accent bar */}
              {active && (
                <div
                  className="absolute left-0 top-2 bottom-2 rounded-r-full"
                  style={{ width: 3, background: 'var(--primary)' }}
                />
              )}
              <Icon size={16} className="shrink-0" />
              <span
                className="overflow-hidden whitespace-nowrap ml-3"
                style={{ opacity: expanded ? 1 : 0, width: expanded ? 'auto' : 0, transition: 'opacity 150ms' }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10">
        <button
          onClick={() => setShowChangelog(true)}
          className="text-white/20 text-[10px] overflow-hidden whitespace-nowrap hover:text-white/40 transition-colors cursor-pointer"
          style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms' }}
        >
          v0.3.12 · Apr 2026
        </button>
      </div>

      {/* Changelog modal */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowChangelog(false)}>
          <div className="bg-white rounded-2xl shadow-xl mx-4 max-w-md w-full max-h-[80dvh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--card-border)' }}>
              <div>
                <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>What&apos;s New</h3>
                <p className="text-[11px] text-[var(--muted)]">v0.3.12 — April 2026</p>
              </div>
              <button onClick={() => setShowChangelog(false)} className="text-[var(--muted)] hover:text-[var(--foreground)] p-1">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 text-xs space-y-4">
              <ChangelogSection title="v0.3.12 — Sticky Header (Done Right)" items={[
                'Reconciliation table now has its own internal scroll area with bounded max-height',
                'Sticky thead sticks to the top of the table container (adapted from MRP app pattern)',
                'Summary cards and filters remain visible above the table; only the rows scroll',
              ]} />
              <ChangelogSection title="v0.3.10 — Round & Sticky-Header Fixes" items={[
                'End-counting now uses the latest round with count 2 sessions instead of requiring exact match to stock take current_round',
                'Fixes case where counters resumed old sessions across multiple reopen cycles (all stuck at round 1)',
                'Sticky table header on reconcile page now actually sticks (was clipped by overflow)',
              ]} />
              <ChangelogSection title="v0.3.9 — Recon Page Review UX" items={[
                'Table header sticks to the top while scrolling long result lists',
                'New Total column in the Count group (sum of Part + WIP + Ext)',
                'Variance/percentage formatted to max 1 decimal place (no more floating-point noise)',
                'New calculator icon per row: exclude/include item from deviation calculation (does NOT affect Pastel export)',
                'Excluded items dimmed in the table; summary shows how many are excluded',
              ]} />
              <ChangelogSection title="v0.3.8 — External Stock Carry-Over" items={[
                'External supplier stock is now auto-carried over from count 1 to count 2 for flagged items that were physically recounted',
                'Counter can still override by re-importing external stock in count 2',
                'Prevents the common case where offsite external stock is forgotten during recount',
              ]} />
              <ChangelogSection title="v0.3.7 — Clear Stale Count 2 Data" items={[
                'End-counting in recount mode now clears all count2_* columns before re-aggregating',
                'Fixes stale count2 values hanging around for unflagged items from earlier runs',
              ]} />
              <ChangelogSection title="v0.3.6 — C2-Preference by Variance" items={[
                'C1/C2 toggle, deviation calc, and auto-accept now prefer C2 only when |c2 − pastel| < |c1 − pastel|',
                'Compares recount accuracy vs original, not raw quantity — fixes edge case where recount found more items but was more accurate',
              ]} />
              <ChangelogSection title="v0.3.5 — Count 2 Scoping + C2 Defaults" items={[
                'Count 2 aggregation now only updates items flagged for recount + their chain descendants',
                'Prevents WIP-scan explosions in count 2 from contaminating unflagged XM components',
                'Deviation denominator now total Pastel inventory (stable between counts)',
                'Per-row C1/C2 toggle auto-defaults to C2 when recount found a lower value',
                'Auto-accept uses the same C2-if-lower rule for consistency',
              ]} />
              <ChangelogSection title="v0.3.4 — Deviation Calculation Fix" items={[
                'Overall deviation now divides by expected stock (Pastel), not by counted total',
                'Standard inventory accuracy metric — values now stay within 0–100% in normal cases',
                'Display text updated: "X variance / Y expected" instead of "/ Y counted"',
              ]} />
              <ChangelogSection title="v0.3.3 — End Counting Crash Fix" items={[
                'Fixed NOT NULL constraint error on recount_flagged when ending count 2',
                'Flag updates now applied as separate query to keep batch upsert schemas consistent',
              ]} />
              <ChangelogSection title="v0.3.2 — Uncounted Items Flagged" items={[
                'Items with Pastel stock that were never scanned now flag for recount automatically',
                'Variance left blank (unknown actual qty) — but item appears on recount list for follow-up',
                'New reason label: "Not counted but Pastel has stock"',
              ]} />
              <ChangelogSection title="v0.3.1 — Case-Sensitive Barcode Fix" items={[
                'Barcode lookups are now case-insensitive — mixed-case WIPs like WIP460032(Xavant) now scan correctly',
                'Scan records store canonical DB casing, not uppercased input',
                'End-counting aggregates across any case variation (backward-compatible with existing scans)',
                'Per-counter breakdown handles mixed-case WIPs correctly',
              ]} />
              <ChangelogSection title="Dry Run Improvements" items={[
                'Submit confirmation dialog — prevents accidental session submission',
                'Chained parts collapse under parent with "+N chain" badge',
                'External supplier Excel import with preview and validation',
                'Recount list now shows WIP codes that were actually scanned',
                'Per-counter breakdown in reconciliation detail view',
              ]} />
              <ChangelogSection title="Reconciliation" items={[
                'Separate EXT column (Part | WIP | Ext) for clarity',
                'Overall deviation summary with visual ring indicator',
                'Value variance (ZAR) shown in summary',
              ]} />
              <ChangelogSection title="Count Page" items={[
                'Import External Suppliers link on count page',
                'Submitted sessions expandable to show scan details',
                'Location badges (Main / Quarantine / External) per scan',
              ]} />
              <ChangelogSection title="Bug Fixes" items={[
                'Supabase 1000-row limit — paginated all large queries (BOM, inventory, results)',
                'WIP explosion qty_per_wip null safety',
                'Session resume preserves external/chained flags',
                'Recount list filters to actually-scanned WIPs and chain parents only',
                'Chain parent recount limited to stores where actually scanned',
              ]} />
              <ChangelogSection title="Other" items={[
                'BOM component delete confirmation dialog',
                'Stock take period changed from quarterly to monthly',
              ]} />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    setup: '#94a3b8', checklist: '#f59e0b', counting: '#22c55e',
    recount: '#f59e0b', reviewing: '#3b82f6', complete: '#059669',
  };
  const labels: Record<string, string> = {
    setup: 'Setup', checklist: 'Checklist', counting: 'Counting',
    recount: 'Recount', reviewing: 'Reviewing', complete: 'Complete',
  };
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors[status] || '#94a3b8' }} />
      <span className="text-[10px]" style={{ color: colors[status] || '#94a3b8' }}>
        {labels[status] || status}
      </span>
    </div>
  );
}

function ChangelogSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[var(--foreground)] leading-relaxed">
            <span className="text-[var(--primary)] mt-0.5 flex-shrink-0">·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
