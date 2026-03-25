'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, RotateCcw } from 'lucide-react';

export type EngineId = 'html5qr' | 'zxing-wasm' | 'quagga2' | 'native';

interface EngineInfo {
  id: EngineId;
  label: string;
  available: boolean;
}

interface DiagEntry {
  barcode: string;
  valid: boolean;
  time: number;
}

interface DiagnosticScannerProps {
  active: boolean;
  stockTakeId: string;
  onCancel?: () => void;
  onExit?: () => void;
}

const DEBOUNCE_MS = 1500;

export function DiagnosticScanner({ active, stockTakeId, onCancel, onExit }: DiagnosticScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number>(0);
  const engineRef = useRef<any>(null);
  const lastDecodeRef = useRef<string>('');
  const lastDecodeTimeRef = useRef<number>(0);

  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [activeEngine, setActiveEngine] = useState<EngineId | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<DiagEntry[]>([]);

  // Detect available engines on mount
  useEffect(() => {
    const available: EngineInfo[] = [
      { id: 'html5qr', label: 'ZXing-JS', available: true },
      { id: 'zxing-wasm', label: 'ZXing-WASM', available: true },
      { id: 'quagga2', label: 'Quagga2', available: true },
    ];
    // Native BarcodeDetector — Chrome Android
    if ('BarcodeDetector' in window) {
      available.push({ id: 'native', label: 'Native', available: true });
    }
    setEngines(available);
    setActiveEngine('html5qr');
  }, []);

  const handleDecode = useCallback(async (decoded: string) => {
    const trimmed = decoded.trim();
    if (!trimmed) return;

    const now = Date.now();
    // Debounce same barcode
    if (trimmed === lastDecodeRef.current && now - lastDecodeTimeRef.current < DEBOUNCE_MS) {
      return;
    }
    lastDecodeRef.current = trimmed;
    lastDecodeTimeRef.current = now;

    // Validate against DB
    let valid = false;
    try {
      const res = await fetch(
        `/api/scan/lookup?barcode=${encodeURIComponent(trimmed)}&stockTakeId=${stockTakeId}`
      );
      const data = await res.json();
      valid = !!data.valid;
    } catch { /* treat as invalid */ }

    // Vibrate on any decode
    if (navigator.vibrate) navigator.vibrate(valid ? [50] : [30, 30, 30]);

    setLog(prev => [...prev, { barcode: trimmed, valid, time: now }]);
  }, [stockTakeId]);

  const stopScanLoop = useCallback(() => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = 0;
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopScanLoop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    engineRef.current = null;
    setStarted(false);
  }, [stopScanLoop]);

  // Start camera (shared across all engines except html5qr which manages its own)
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera permission denied.');
      } else {
        setError(`Camera error: ${msg}`);
      }
      return false;
    }
  }, []);

  // ── Engine: html5-qrcode (ZXing-JS) — manages its own camera ──
  const html5qrContainerRef = useRef<HTMLDivElement>(null);
  const html5qrRef = useRef<any>(null);

  const startHtml5Qr = useCallback(async () => {
    if (!html5qrContainerRef.current) return;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const id = 'diag-html5qr-region';
      html5qrContainerRef.current.id = id;

      const scanner = new Html5Qrcode(id, {
        formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128],
        verbose: false,
      });
      html5qrRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 120 }, aspectRatio: 1.777 },
        (decoded: string) => handleDecode(decoded),
        () => {}
      );
      setStarted(true);
      setError(null);
    } catch (e) {
      setError(`html5-qrcode error: ${e instanceof Error ? e.message : e}`);
    }
  }, [handleDecode]);

  const stopHtml5Qr = useCallback(async () => {
    if (html5qrRef.current) {
      try {
        if (html5qrRef.current.getState() === 2) await html5qrRef.current.stop();
      } catch {}
      try { html5qrRef.current.clear(); } catch {}
      html5qrRef.current = null;
    }
  }, []);

  // ── Engine: zxing-wasm — own camera + frame loop ──
  const startZxingWasm = useCallback(async () => {
    const ok = await startCamera();
    if (!ok) return;

    const { readBarcodes } = await import('zxing-wasm/reader');
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    setStarted(true);
    setError(null);

    const scan = async () => {
      if (!streamRef.current || !video.videoWidth) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const results = await readBarcodes(imageData, {
          formats: ['Code128'],
          tryHarder: true,
        });
        for (const r of results) {
          if (r.text) handleDecode(r.text);
        }
      } catch {}

      setTimeout(() => {
        if (streamRef.current) scanLoopRef.current = requestAnimationFrame(scan);
      }, 100); // ~10 FPS
    };
    scanLoopRef.current = requestAnimationFrame(scan);
  }, [startCamera, handleDecode]);

  // ── Engine: quagga2 — own camera + frame loop ──
  const startQuagga = useCallback(async () => {
    const ok = await startCamera();
    if (!ok) return;

    const Quagga = (await import('@ericblade/quagga2')).default;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    setStarted(true);
    setError(null);

    const scan = async () => {
      if (!streamRef.current || !video.videoWidth) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const result = await new Promise<any>((resolve) => {
          Quagga.decodeSingle({
            src: dataUrl,
            numOfWorkers: 0,
            decoder: { readers: ['code_128_reader'] },
            locate: true,
          }, (res: any) => resolve(res));
        });
        if (result?.codeResult?.code) {
          handleDecode(result.codeResult.code);
        }
      } catch {}

      setTimeout(() => {
        if (streamRef.current) scanLoopRef.current = requestAnimationFrame(scan);
      }, 200); // ~5 FPS (heavier processing)
    };
    scanLoopRef.current = requestAnimationFrame(scan);
  }, [startCamera, handleDecode]);

  // ── Engine: Native BarcodeDetector ──
  const startNative = useCallback(async () => {
    const ok = await startCamera();
    if (!ok) return;

    const detector = new (window as any).BarcodeDetector({ formats: ['code_128'] });
    const video = videoRef.current!;

    setStarted(true);
    setError(null);

    const scan = async () => {
      if (!streamRef.current || !video.videoWidth) {
        scanLoopRef.current = requestAnimationFrame(scan);
        return;
      }

      try {
        const barcodes = await detector.detect(video);
        for (const b of barcodes) {
          if (b.rawValue) handleDecode(b.rawValue);
        }
      } catch {}

      setTimeout(() => {
        if (streamRef.current) scanLoopRef.current = requestAnimationFrame(scan);
      }, 66); // ~15 FPS
    };
    scanLoopRef.current = requestAnimationFrame(scan);
  }, [startCamera, handleDecode]);

  // ── Switch engine ──
  const switchEngine = useCallback(async (engineId: EngineId) => {
    // Stop everything
    stopScanLoop();
    await stopHtml5Qr();
    stopCamera();
    setError(null);

    setActiveEngine(engineId);
    // Small delay to let DOM settle
    await new Promise(r => setTimeout(r, 100));

    switch (engineId) {
      case 'html5qr': await startHtml5Qr(); break;
      case 'zxing-wasm': await startZxingWasm(); break;
      case 'quagga2': await startQuagga(); break;
      case 'native': await startNative(); break;
    }
  }, [stopScanLoop, stopHtml5Qr, stopCamera, startHtml5Qr, startZxingWasm, startQuagga, startNative]);

  // Start on mount
  useEffect(() => {
    if (active && activeEngine) {
      switchEngine(activeEngine);
    }
    return () => {
      stopScanLoop();
      stopHtml5Qr();
      stopCamera();
    };
  }, [active]); // Only on active change, not on engine change

  if (!active) return null;

  // Stats
  const total = log.length;
  const valid = log.filter(d => d.valid).length;
  const pct = total > 0 ? Math.round((valid / total) * 100) : 0;
  let avgInterval = 0;
  if (total >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < log.length; i++) {
      intervals.push(log[i].time - log[i - 1].time);
    }
    avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }
  const last = log.length > 0 ? log[log.length - 1] : null;

  return (
    <div className="space-y-3">
      {/* Engine selector */}
      <div className="flex gap-1.5 flex-wrap">
        {engines.map(eng => (
          <button
            key={eng.id}
            onClick={() => switchEngine(eng.id)}
            className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all"
            style={{
              background: activeEngine === eng.id ? 'var(--primary)' : 'var(--card-bg)',
              color: activeEngine === eng.id ? 'white' : 'var(--muted)',
              border: `1px solid ${activeEngine === eng.id ? 'var(--primary)' : 'var(--card-border)'}`,
            }}
          >
            {eng.label}
          </button>
        ))}
      </div>

      {/* Camera viewport */}
      <div className="rounded-xl overflow-hidden border relative" style={{ borderColor: 'var(--card-border)' }}>
        {/* Cancel / Exit buttons */}
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          {onExit && (
            <button
              onClick={onExit}
              className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
            >
              <X size={16} className="text-white" />
            </button>
          )}
        </div>

        {/* html5-qrcode manages its own video in this container */}
        {activeEngine === 'html5qr' && (
          <div
            ref={html5qrContainerRef}
            className="w-full bg-black"
            style={{ minHeight: 200 }}
          />
        )}

        {/* All other engines: shared video element */}
        {activeEngine !== 'html5qr' && (
          <div className="relative w-full bg-black" style={{ minHeight: 200 }}>
            <video
              ref={videoRef}
              className="w-full"
              playsInline
              muted
              style={{ display: started ? 'block' : 'none' }}
            />
            {started && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="border-2 border-white/60 rounded-lg"
                  style={{ width: '75%', height: 60, boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)' }}
                />
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {!error && !started && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-white/60 text-sm">
            <div className="text-center">
              <Camera size={24} className="mx-auto mb-2 opacity-50" />
              Starting camera...
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-[var(--error-light)] text-[var(--error)] text-sm text-center">
            {error}
          </div>
        )}
      </div>

      {/* Stats panel */}
      <div className="p-3 rounded-lg text-xs space-y-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
            {engines.find(e => e.id === activeEngine)?.label || ''} — Diagnostics
          </span>
          <button
            onClick={() => {
              setLog([]);
              lastDecodeRef.current = '';
              lastDecodeTimeRef.current = 0;
            }}
            className="text-[10px] text-[var(--muted)] flex items-center gap-1 hover:text-[var(--primary)]"
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>{total}</div>
            <div className="text-[10px] text-[var(--muted)]">Scans</div>
          </div>
          <div>
            <div className="text-lg font-bold" style={{
              fontFamily: 'var(--font-display)',
              color: total === 0 ? 'var(--muted)' : pct >= 50 ? 'var(--success)' : 'var(--error)',
            }}>{total > 0 ? `${pct}%` : '—'}</div>
            <div className="text-[10px] text-[var(--muted)]">Valid</div>
          </div>
          <div>
            <div className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {avgInterval > 0 ? `${(avgInterval / 1000).toFixed(1)}s` : '—'}
            </div>
            <div className="text-[10px] text-[var(--muted)]">Avg interval</div>
          </div>
        </div>

        {last && (
          <div className="text-[10px] font-mono truncate" style={{ color: last.valid ? 'var(--success)' : 'var(--error)' }}>
            Last: {last.barcode} {last.valid ? '✓' : '✗'}
          </div>
        )}

        {/* Recent scan log */}
        {log.length > 0 && (
          <div className="max-h-24 overflow-y-auto border-t pt-1 mt-1" style={{ borderColor: 'var(--card-border)' }}>
            {log.slice(-8).reverse().map((entry, i) => (
              <div key={i} className="text-[10px] font-mono flex justify-between py-0.5"
                style={{ color: entry.valid ? 'var(--success)' : 'var(--error)' }}>
                <span className="truncate">{entry.barcode}</span>
                <span className="flex-shrink-0 ml-2">{entry.valid ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
