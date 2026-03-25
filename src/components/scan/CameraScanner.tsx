'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera } from 'lucide-react';

interface CameraScannerProps {
  active: boolean;
  onScan: (barcode: string) => void;
}

// Number of identical consecutive reads required before accepting
const CONSENSUS_COUNT = 3;
// Max time window (ms) for consensus reads to accumulate
const CONSENSUS_WINDOW = 2000;
// Debounce: ignore same accepted barcode within this window
const DEBOUNCE_MS = 2000;

export function CameraScanner({ active, onScan }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<'native' | 'zxing' | null>(null);

  // Consensus tracking: accumulate identical reads
  const consensusRef = useRef<{ value: string; count: number; firstSeen: number }>({
    value: '', count: 0, firstSeen: 0,
  });

  // Debounce: don't re-fire same accepted barcode
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
      return; // Need more reads
    }

    if (c.count >= CONSENSUS_COUNT) {
      // Consensus reached — fire callback
      lastAcceptedRef.current = trimmed;
      lastAcceptedTimeRef.current = now;
      consensusRef.current = { value: '', count: 0, firstSeen: 0 };
      onScanRef.current(trimmed);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStarted(false);
    setMode(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check for native BarcodeDetector (Chrome Android, Safari 17.2+)
      const hasNative = 'BarcodeDetector' in window;
      let detector: any = null;

      if (hasNative) {
        try {
          const formats = await (window as any).BarcodeDetector.getSupportedFormats();
          if (formats.includes('code_128')) {
            detector = new (window as any).BarcodeDetector({ formats: ['code_128'] });
            setMode('native');
          }
        } catch {
          // Native detector failed — fall through to ZXing
        }
      }

      if (!detector) {
        // Fallback: use html5-qrcode (ZXing-js) in video-frame mode
        setMode('zxing');
      }

      // Pre-load ZXing fallback if needed
      let zxingInstance: any = null;
      if (!detector) {
        try {
          const { Html5Qrcode } = await import('html5-qrcode');
          // Instance method — needs a dummy container element
          const dummyDiv = document.createElement('div');
          dummyDiv.id = 'zxing-fallback-' + Date.now();
          dummyDiv.style.display = 'none';
          document.body.appendChild(dummyDiv);
          zxingInstance = new Html5Qrcode(dummyDiv.id);
          setMode('zxing');
        } catch {
          setError('Could not load barcode scanner library.');
          return;
        }
      }

      setStarted(true);
      setError(null);

      // Scan loop — capture frames and decode
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

      const scanFrame = async () => {
        if (!streamRef.current || !video.videoWidth) {
          animFrameRef.current = requestAnimationFrame(scanFrame);
          return;
        }

        try {
          if (detector) {
            // Native BarcodeDetector — very accurate, works directly on video element
            const barcodes = await detector.detect(video);
            for (const barcode of barcodes) {
              acceptBarcode(barcode.rawValue);
            }
          } else if (zxingInstance) {
            // ZXing fallback — capture frame to canvas, convert to file, decode
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85);
            });
            if (blob) {
              const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
              try {
                const result = await zxingInstance.scanFile(file, false);
                if (result) acceptBarcode(result);
              } catch {
                // No barcode in frame — normal
              }
            }
          }
        } catch {
          // Scan error — ignore, try next frame
        }

        // ~15 FPS for native, ~5 FPS for ZXing fallback (heavier processing)
        const delay = detector ? 66 : 200;
        setTimeout(() => {
          if (streamRef.current) {
            animFrameRef.current = requestAnimationFrame(scanFrame);
          }
        }, delay);
      };

      animFrameRef.current = requestAnimationFrame(scanFrame);
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
      startCamera();
    } else {
      stopCamera();
    }
    return () => { stopCamera(); };
  }, [active, startCamera, stopCamera]);

  if (!active) return null;

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--card-border)' }}>
      {/* Camera viewport */}
      <div className="relative w-full bg-black" style={{ minHeight: 200 }}>
        <video
          ref={videoRef}
          className="w-full"
          playsInline
          muted
          style={{ display: started ? 'block' : 'none' }}
        />
        {/* Scan guide overlay */}
        {started && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="border-2 border-white/60 rounded-lg"
              style={{ width: '75%', height: 60, boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)' }}
            />
          </div>
        )}
        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Mode indicator */}
      {started && mode && (
        <div className="px-3 py-1.5 text-[10px] text-center" style={{ color: 'var(--muted)', background: 'var(--card-bg)' }}>
          {mode === 'native' ? 'Native barcode detection' : 'Software barcode detection'} · Consensus: {CONSENSUS_COUNT} reads
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
