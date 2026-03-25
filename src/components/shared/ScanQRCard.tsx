'use client';

import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { Smartphone } from 'lucide-react';

interface ScanQRCardProps {
  compact?: boolean;
}

export function ScanQRCard({ compact = false }: ScanQRCardProps) {
  const [scanUrl, setScanUrl] = useState('');

  useEffect(() => {
    // Fetch the server's local network IP so the QR code works on phones
    // Use HTTPS port 3443 (local-ssl-proxy) for camera access on mobile
    async function resolveUrl() {
      const { protocol, port } = window.location;
      try {
        const res = await fetch('/api/network-info');
        const { ip } = await res.json();
        setScanUrl(`${protocol}//${ip}${port ? `:${port}` : ''}/scan`);
      } catch {
        setScanUrl(`${window.location.origin}/scan`);
      }
    }
    resolveUrl();
  }, []);

  if (!scanUrl) return null;

  if (compact) {
    return (
      <div className="card p-4 flex items-center gap-4">
        <div className="bg-white p-2 rounded-lg flex-shrink-0" style={{ lineHeight: 0 }}>
          <QRCode value={scanUrl} size={72} level="M" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Smartphone size={14} style={{ color: 'var(--primary)' }} />
            <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
              Open Scanner
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            Scan with your phone to start counting
          </div>
          <div className="text-[11px] font-mono text-[var(--muted-light)] mt-0.5 truncate">
            {scanUrl}
          </div>
        </div>
        <button
          onClick={() => navigator.clipboard?.writeText(scanUrl)}
          className="text-xs text-[var(--primary)] font-medium hover:underline flex-shrink-0"
        >
          Copy
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 flex flex-col items-center text-center">
      <div className="bg-white p-3 rounded-xl mb-3 shadow-sm" style={{ lineHeight: 0 }}>
        <QRCode value={scanUrl} size={140} level="M" />
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        <Smartphone size={16} style={{ color: 'var(--primary)' }} />
        <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          Scan to Count
        </span>
      </div>
      <div className="text-[11px] text-[var(--muted)]">
        Open your phone camera and point at this code
      </div>
      <div className="text-[11px] font-mono text-[var(--muted-light)] mt-1">{scanUrl}</div>
    </div>
  );
}
