import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stock Take — Xavant',
  description: 'Quarterly stock take management for Xavant Technology',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
