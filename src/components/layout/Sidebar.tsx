'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardList, Package, GitBranch, ScanLine,
  BarChart3, FileDown, Settings, ChevronRight, Database,
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

const EXPANDED_W = 224; // w-56
const COLLAPSED_W = 56;

interface SidebarProps {
  stockTakeRef?: string;
  status?: string;
}

export function Sidebar({ stockTakeRef, status }: SidebarProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{
        background: 'var(--sidebar)',
        minHeight: '100vh',
        width: expanded ? EXPANDED_W : COLLAPSED_W,
        transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div className="px-3 py-4 border-b border-white/10" style={{ minHeight: expanded ? 'auto' : 56 }}>
        <div className="flex items-center gap-2.5">
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

        {/* Active stock take ref — only shown when expanded */}
        {expanded && (
          <div className="mt-3 px-2 py-1.5 rounded-md bg-white/5 border border-white/10 min-h-[3.25rem]">
            {stockTakeRef ? (
              <>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">Active</div>
                <div className="text-white text-xs font-medium mt-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
                  {stockTakeRef}
                </div>
                {status && <StatusDot status={status} />}
              </>
            ) : (
              <div className="text-white/20 text-[10px] uppercase tracking-wider pt-1">No active stock take</div>
            )}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-lg text-sm transition-colors group"
              style={{
                background: active ? 'var(--sidebar-active)' : 'transparent',
                color: active ? 'white' : 'rgba(255,255,255,0.5)',
                padding: expanded ? '10px 12px' : '10px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
              }}
              title={expanded ? undefined : label}
            >
              <Icon size={16} className="shrink-0" />
              <span
                className="flex-1 overflow-hidden whitespace-nowrap"
                style={{ opacity: expanded ? 1 : 0, width: expanded ? 'auto' : 0, transition: 'opacity 150ms' }}
              >
                {label}
              </span>
              {active && expanded && <ChevronRight size={12} className="opacity-50 shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/10">
        <div
          className="text-white/20 text-[10px] overflow-hidden whitespace-nowrap"
          style={{ opacity: expanded ? 1 : 0, transition: 'opacity 150ms' }}
        >
          v0.2.0
        </div>
      </div>
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
