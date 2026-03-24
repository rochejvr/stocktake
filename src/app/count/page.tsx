'use client';
import { AppShell } from '@/components/layout/AppShell';
import { Construction } from 'lucide-react';
export default function Page() {
  const labels: Record<string,string> = { count: 'Live Count', reconcile: 'Reconcile', export: 'Export' };
  const descs: Record<string,string> = {
    count: 'Real-time scan feed — waiting for Pastel files to configure',
    reconcile: 'Variance analysis and recount management',
    export: 'Generate Pastel CSV for accepted deviations'
  };
  return (
    <AppShell>
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-center text-[var(--muted)]">
          <Construction size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-medium text-[var(--foreground)]">{labels['count']}</div>
          <div className="text-sm mt-1">{descs['count']}</div>
        </div>
      </div>
    </AppShell>
  );
}
