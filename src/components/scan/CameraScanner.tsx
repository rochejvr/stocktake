'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X } from 'lucide-react';

interface CameraScannerProps {
  active: boolean;
  onScan: (barcode: string) => void;
  onCancel?: () => void;
}

export function CameraScanner({ active, onScan, onCancel }: CameraScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const lastScanRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);

  const startScanner = useCallback(async () => {
    if (!scannerRef.current || html5QrCodeRef.current) return;

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      const scannerId = 'camera-scanner-region';
      if (scannerRef.current) {
        scannerRef.current.id = scannerId;
      }

      const scanner = new Html5Qrcode(scannerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
        verbose: false,
      });
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 120 },
          aspectRatio: 1.777,
        },
        (decodedText: string) => {
          // Debounce: ignore same barcode within 2 seconds
          const now = Date.now();
          if (decodedText === lastScanRef.current && now - lastScanTimeRef.current < 2000) {
            return;
          }
          lastScanRef.current = decodedText;
          lastScanTimeRef.current = now;
          onScan(decodedText);
        },
        () => { /* ignore scan failures (no barcode in frame) */ }
      );

      setStarted(true);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Permission')) {
        setError('Camera permission denied. Please allow camera access.');
      } else if (msg.includes('NotFound') || msg.includes('not found')) {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, [onScan]);

  const stopScanner = useCallback(async () => {
    if (html5QrCodeRef.current) {
      try {
        const state = html5QrCodeRef.current.getState();
        // State 2 = SCANNING
        if (state === 2) {
          await html5QrCodeRef.current.stop();
        }
      } catch { /* ignore */ }
      try {
        html5QrCodeRef.current.clear();
      } catch { /* ignore */ }
      html5QrCodeRef.current = null;
      setStarted(false);
    }
  }, []);

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

      {/* Scanner viewport */}
      <div
        ref={scannerRef}
        className="w-full bg-black"
        style={{ minHeight: 200 }}
      />

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
