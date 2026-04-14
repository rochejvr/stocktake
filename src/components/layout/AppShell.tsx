'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

// Routes that render without the sidebar (standalone mobile pages)
const STANDALONE_ROUTES = ['/scan'];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isStandalone = STANDALONE_ROUTES.includes(pathname);

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden dot-grid-bg">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
