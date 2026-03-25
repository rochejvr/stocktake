'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Search, Database, CheckCircle, XCircle, Package } from 'lucide-react';

interface CatalogItem {
  part_number: string;
  description: string;
  active: boolean;
  last_seen_at: string | null;
}

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (showInactive) params.set('active', 'false');
    const url = `/api/components?${params}`;

    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(url)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setItems(data); })
        .finally(() => setLoading(false));
    }, search ? 300 : 0);

    return () => clearTimeout(timeout);
  }, [search, showInactive]);

  const activeCount = items.filter(i => i.active).length;
  const inactiveCount = items.filter(i => !i.active).length;

  return (
    <AppShell>
      <div className="p-8 ">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Database size={20} style={{ color: 'var(--primary)' }} />
              <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                Component Catalog
              </h1>
            </div>
            <p className="text-sm text-[var(--muted)]">
              Master list of all components from Pastel imports
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-green">{activeCount} active</span>
            {inactiveCount > 0 && (
              <span className="badge badge-slate">{inactiveCount} inactive</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
            <input
              className="input pl-8"
              placeholder="Search part number or description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer select-none hover:text-[var(--foreground)] transition-colors">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded accent-[var(--primary)]"
            />
            Show inactive
          </label>
        </div>

        {/* Table */}
        <div className="card-elevated overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-[var(--muted)]">
              <Package size={32} className="mx-auto mb-3 opacity-20" />
              <div className="text-sm font-medium">No components found</div>
              {search && <div className="text-xs mt-1">Try a different search term</div>}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Part Number</th>
                  <th>Description</th>
                  <th className="w-20 text-center">Status</th>
                  <th className="w-32">Last Import</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.part_number} style={{ opacity: item.active ? 1 : 0.45 }}>
                    <td>
                      <span className="font-mono text-xs font-medium">{item.part_number}</span>
                    </td>
                    <td className="text-sm">{item.description || <span className="text-[var(--muted-light)] italic">—</span>}</td>
                    <td className="text-center">
                      {item.active ? (
                        <CheckCircle size={14} className="inline text-green-500" />
                      ) : (
                        <XCircle size={14} className="inline text-slate-300" />
                      )}
                    </td>
                    <td className="text-xs text-[var(--muted)]">
                      {item.last_seen_at ? new Date(item.last_seen_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
