'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X } from 'lucide-react';

interface CameraScannerProps {
  active: boolean;
  onScan: (barcode: string) => void;
  onCancel?: () => void;
}

const DEBOUNCE_MS = 2000;

export function CameraScanner({ active, onScan, onCancel }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [waitingLong, setWaitingLong] = useState(false);
  const lastScanRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopScanner = useCallback(() => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStarted(false);
  }, []);

  const startScanner = useCallback(async () => {
    try {
      // Check if camera permission is already denied before attempting
      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (perm.state === 'denied') {
            setError('Camera permission is blocked. Open your browser settings → Site Settings → Camera, and allow access for this site.');
            return;
          }
        } catch { /* permissions API not supported — continue anyway */ }
      }

      // Request camera with a timeout — some devices hang if the permission prompt never appears
      const CAMERA_TIMEOUT_MS = 10_000;
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CAMERA_TIMEOUT')), CAMERA_TIMEOUT_MS)
        ),
      ]);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Load ZXing-WASM reader
      const { readBarcodes } = await import('zxing-wasm/reader');

      setStarted(true);
      setError(null);

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

      const scan = async () => {
        if (!streamRef.current || !video.videoWidth) {
          scanLoopRef.current = requestAnimationFrame(scan);
          return;
        }

        // Crop to scan guide region (center 75% width, ~10% height strip)
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const cropW = Math.round(vw * 0.75);
        const cropH = Math.round(vh * 0.12);
        const cropX = Math.round((vw - cropW) / 2);
        const cropY = Math.round((vh - cropH) / 2);

        canvas.width = cropW;
        canvas.height = cropH;
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const imageData = ctx.getImageData(0, 0, cropW, cropH);

        try {
          const results = await readBarcodes(imageData, {
            formats: ['Code128'],
            tryHarder: true,
          });
          for (const r of results) {
            if (!r.text) continue;
            const now = Date.now();
            if (r.text === lastScanRef.current && now - lastScanTimeRef.current < DEBOUNCE_MS) {
              continue;
            }
            lastScanRef.current = r.text;
            lastScanTimeRef.current = now;
            onScanRef.current(r.text);
          }
        } catch { /* decode error — ignore */ }

        setTimeout(() => {
          if (streamRef.current) scanLoopRef.current = requestAnimationFrame(scan);
        }, 100); // ~10 FPS
      };

      scanLoopRef.current = requestAnimationFrame(scan);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'CAMERA_TIMEOUT') {
        setError('Camera did not start — your browser may not have asked for permission. Go to browser Settings → Site Settings → Camera and make sure this site is allowed.');
      } else if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera permission denied. Go to browser Settings → Site Settings → Camera and allow access for this site.');
      } else if (msg.includes('NotFound') || msg.includes('not found')) {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, []);

  useEffect(() => {
    if (active) {
      setWaitingLong(false);
      startScanner();
      // After 4s, hint that something may be wrong
      const hint = setTimeout(() => setWaitingLong(true), 4000);
      return () => { clearTimeout(hint); stopScanner(); };
    } else {
      stopScanner();
      return () => { stopScanner(); };
    }
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

      {/* Camera viewport */}
      <div className="relative w-full bg-black" style={{ minHeight: 200 }}>
        <video
          ref={videoRef}
          className="w-full"
          playsInline
          muted
          style={{ display: started ? 'block' : 'none', maxHeight: '40vh', objectFit: 'cover' }}
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
        <canvas ref={canvasRef} className="hidden" />
      </div>

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
            {waitingLong && (
              <p className="mt-3 text-xs text-yellow-400/80">
                Taking longer than expected. If you see a permission prompt, please tap &quot;Allow&quot;.
                If not, check your browser settings.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
