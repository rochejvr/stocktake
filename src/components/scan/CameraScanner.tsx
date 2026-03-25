'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X } from 'lucide-react';

interface CameraScannerProps {
  active: boolean;
  onScan: (barcode: string) => void;
  onCancel?: () => void;
}

// Number of identical consecutive reads required before accepting
const CONSENSUS_COUNT = 2;
// Max time window (ms) for consensus reads to accumulate
const CONSENSUS_WINDOW = 3000;
// Debounce: ignore same accepted barcode within this window
const DEBOUNCE_MS = 2000;

export function CameraScanner({ active, onScan, onCancel }: CameraScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const html5QrCodeRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<'native' | 'zxing' | null>(null);

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

    // Consensus: require CONSENSUS_COUNT identical reads within CONSENSUS_WINDOW
    const c = consensusRef.current;
    if (trimmed === c.value && now - c.firstSeen < CONSENSUS_WINDOW) {
      c.count++;
    } else {
      // New barcode or window expired — reset
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

  const stopAll = useCallback(async () => {
    // Stop native path
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // Stop ZXing path
    if (html5QrCodeRef.current) {
      try {
        const state = html5QrCodeRef.current.getState();
        if (state === 2) await html5QrCodeRef.current.stop();
      } catch { /* ignore */ }
      try { html5QrCodeRef.current.clear(); } catch { /* ignore */ }
      html5QrCodeRef.current = null;
    }
    setStarted(false);
    setMode(null);
  }, []);

  const startScanner = useCallback(async () => {
    // ── Try native BarcodeDetector first (Chrome Android) ──
    let useNative = false;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await (window as any).BarcodeDetector.getSupportedFormats();
        if (formats.includes('code_128')) {
          useNative = true;
        }
      } catch { /* not available */ }
    }

    if (useNative) {
      // Native path: own video element + requestAnimationFrame
      try {
        const detector = new (window as any).BarcodeDetector({ formats: ['code_128'] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setMode('native');
        setStarted(true);
        setError(null);

        const video = videoRef.current!;
        const scanFrame = async () => {
          if (!streamRef.current || !video.videoWidth) {
            animFrameRef.current = requestAnimationFrame(scanFrame);
            return;
          }
          try {
            const barcodes = await detector.detect(video);
            for (const b of barcodes) acceptBarcode(b.rawValue);
          } catch { /* ignore */ }
          setTimeout(() => {
            if (streamRef.current) animFrameRef.current = requestAnimationFrame(scanFrame);
          }, 66); // ~15 FPS
        };
        animFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      } catch {
        // Fall through to ZXing
      }
    }

    // ── ZXing fallback: use Html5Qrcode.start() (proven to work on iOS) ──
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

      const scannerId = 'camera-scanner-region';
      if (scannerRef.current) scannerRef.current.id = scannerId;

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

      setMode('zxing');
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
      stopAll();
    }
    return () => { stopAll(); };
  }, [active, startScanner, stopAll]);

  if (!active) return null;

  return (
    <div className="rounded-xl overflow-hidden border relative" style={{ borderColor: 'var(--card-border)' }}>
      {/* Cancel button */}
      {onCancel && started && (
        <button
          onClick={onCancel}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
        >
          <X size={16} className="text-white" />
        </button>
      )}

      {/* Native path: own video element */}
      {mode === 'native' && (
        <div className="relative w-full bg-black" style={{ maxHeight: 260 }}>
          <video
            ref={videoRef}
            className="w-full"
            playsInline
            muted
            style={{ display: started ? 'block' : 'none', maxHeight: 260, objectFit: 'cover' }}
          />
          {started && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="border-2 border-white/60 rounded-lg"
                style={{ width: '75%', height: 50, boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)' }}
              />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {/* ZXing path: Html5Qrcode manages its own video inside this div */}
      {mode !== 'native' && (
        <div
          ref={scannerRef}
          className="w-full bg-black"
          style={{ maxHeight: 260 }}
        />
      )}

      {/* Mode indicator */}
      {started && mode && (
        <div className="px-3 py-1 text-[10px] text-center" style={{ color: 'var(--muted)', background: 'var(--card-bg)' }}>
          {mode === 'native' ? 'Native detection' : 'Software detection'} · {CONSENSUS_COUNT}× verify
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
