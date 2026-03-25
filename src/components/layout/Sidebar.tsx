'use client';

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

interface SidebarProps {
  stockTakeRef?: string;
  status?: string;
}

export function Sidebar({ stockTakeRef, status }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="w-56 flex-shrink-0 flex flex-col"
      style={{ background: 'var(--sidebar)', minHeight: '100vh' }}
    >
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ background: 'var(--primary)', fontFamily: 'var(--font-display)' }}
          >
            ST
          </div>
          <div>
            <div className="text-white font-semibold text-sm" style={{ fontFamily: 'var(--font-display)' }}>
              Stock Take
            </div>
            <div className="text-white/40 text-xs">Xavant Technology</div>
          </div>
        </div>

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
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors group"
              style={{
                background: active ? 'var(--sidebar-active)' : 'transparent',
                color: active ? 'white' : 'rgba(255,255,255,0.5)',
              }}
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight size={12} className="opacity-50" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-white/20 text-[10px]">v0.2.0</div>
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
