'use client';
import { AppShell } from '@/components/layout/AppShell';
import { Construction } from 'lucide-react';
export default function ChecklistPage() {
  return (
    <AppShell>
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-center text-[var(--muted)]">
          <Construction size={32} className="mx-auto mb-3 opacity-30" />
          <div className="font-medium text-[var(--foreground)]">Checklist</div>
          <div className="text-sm mt-1">Coming soon — pre-stock take sign-off</div>
        </div>
      </div>
    </AppShell>
  );
}
