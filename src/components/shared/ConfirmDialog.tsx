'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="card p-6 mx-4 max-w-sm w-full shadow-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-full ${destructive ? 'bg-red-50' : 'bg-amber-50'}`}>
            <AlertTriangle size={20} className={destructive ? 'text-red-500' : 'text-amber-500'} />
          </div>
          <div>
            <h3 className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
            <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border text-sm font-semibold transition-colors hover:bg-slate-50 cursor-pointer"
            style={{ borderColor: 'var(--card-border)' }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`h-9 px-4 rounded-lg text-sm font-semibold text-white cursor-pointer transition-colors ${
              destructive ? 'bg-red-500 hover:bg-red-600' : 'hover:opacity-90'
            }`}
            style={destructive ? undefined : { background: 'var(--primary)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
