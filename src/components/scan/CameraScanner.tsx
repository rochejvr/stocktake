'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X } from 'lucide-react';

interface CameraScannerProps {
  active: boolean;
  onScan: (barcode: string) => void;
  onCancel?: () => void;
}

// Consensus: require 2 identical reads within 3s before accepting
const CONSENSUS_COUNT = 2;
const CONSENSUS_WINDOW = 3000;
const DEBOUNCE_MS = 2000;

export function CameraScanner({ active, onScan, onCancel }: CameraScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  // Consensus tracking
  const consensusRef = useRef<{ value: string; count: number; firstSeen: number }>({
    value: '', count: 0, firstSeen: 0,
  });
  const lastAcceptedRef = useRef<string>('');
  const lastAcceptedTimeRef = useRef<number>(0);

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const acceptBarcode = useCallback((decoded: string) => {
    const now = Date.now();
    const trimmed = decoded.trim();
    if (!trimmed) return;

    // Debounce same accepted barcode
    if (trimmed === lastAcceptedRef.current && now - lastAcceptedTimeRef.current < DEBOUNCE_MS) {
      return;
    }

    // Consensus: require CONSENSUS_COUNT identical reads
    const c = consensusRef.current;
    if (trimmed === c.value && now - c.firstSeen < CONSENSUS_WINDOW) {
      c.count++;
    } else {
      consensusRef.current = { value: trimmed, count: 1, firstSeen: now };
      return;
    }

    if (c.count >= CONSENSUS_COUNT) {
      lastAcceptedRef.current = trimmed;
      lastAcceptedTimeRef.current = now;
      consensusRef.current = { value: '', count: 0, firstSeen: 0 };
      onScanRef.current(trimmed);
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        const state = html5QrCodeRef.current.getState();
        if (state === 2) await html5QrCodeRef.current.stop();
      } catch { /* ignore */ }
      try { html5QrCodeRef.current.clear(); } catch { /* ignore */ }
      html5QrCodeRef.current = null;
      setStarted(false);
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (!scannerRef.current || html5QrCodeRef.current) return;

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      const scannerId = 'camera-scanner-region';
      scannerRef.current.id = scannerId;

      const scanner = new Html5Qrcode(scannerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
        verbose: false,
      });
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 280, height: 100 },
          aspectRatio: 1.333,
        },
        (decodedText: string) => {
          acceptBarcode(decodedText);
        },
        () => { /* no barcode in frame */ }
      );

      setStarted(true);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera permission denied. Please allow camera access.');
      } else if (msg.includes('NotFound') || msg.includes('not found')) {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, [acceptBarcode]);

  useEffect(() => {
    if (active) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [active, startScanner, stopScanner]);

  if (!active) return null;

  return (
    <div className="rounded-xl overflow-hidden border relative" style={{ borderColor: 'var(--card-border)' }}>
      {/* Cancel button */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
        >
          <X size={16} className="text-white" />
        </button>
      )}

      {/* Html5Qrcode manages its own video inside this div */}
      <div
        ref={scannerRef}
        className="w-full bg-black"
        style={{ minHeight: 200 }}
      />

      {/* Mode indicator */}
      {started && (
        <div className="px-3 py-1 text-[10px] text-center" style={{ color: 'var(--muted)', background: 'var(--card-bg)' }}>
          {CONSENSUS_COUNT}× verify enabled
        </div>
      )}

      {error && (
        <div className="p-3 bg-[var(--error-light)] text-[var(--error)] text-sm text-center">
          {error}
        </div>
      )}

      {!error && !started && (
        <div className="p-6 flex items-center justify-center bg-slate-900 text-white/60 text-sm"
          style={{ minHeight: 200 }}>
          <div className="text-center">
            <Camera size={24} className="mx-auto mb-2 opacity-50" />
            Starting camera...
          </div>
        </div>
      )}
    </div>
  );
}
