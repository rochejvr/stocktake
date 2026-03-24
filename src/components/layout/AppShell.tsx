'use client';

import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: React.ReactNode;
  stockTakeRef?: string;
  status?: string;
}

export function AppShell({ children, stockTakeRef, status }: AppShellProps) {
  return (
    <div className="flex min-h-screen dot-grid-bg">
      <Sidebar stockTakeRef={stockTakeRef} status={status} />
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
