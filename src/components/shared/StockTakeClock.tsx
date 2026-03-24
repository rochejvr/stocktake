'use client';

import { useEffect, useState } from 'react';
import { format, differenceInSeconds, isPast } from 'date-fns';

interface StockTakeClockProps {
  countDeadline: string;
  recountDeadline: string;
  startedAt: string | null;
}

export function StockTakeClock({ countDeadline, recountDeadline, startedAt }: StockTakeClockProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const countDL  = new Date(countDeadline);
  const recountDL = new Date(recountDeadline);
  const start    = startedAt ? new Date(startedAt) : null;

  const countPast   = isPast(countDL);
  const recountPast = isPast(recountDL);

  const secsToCount   = Math.max(0, differenceInSeconds(countDL, now));
  const secsToRecount = Math.max(0, differenceInSeconds(recountDL, now));

  function fmtCountdown(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  // Progress along timeline: start → count deadline → recount deadline
  const totalMs = recountDL.getTime() - (start?.getTime() ?? countDL.getTime() - 5 * 3600_000);
  const elapsedMs = now.getTime() - (start?.getTime() ?? countDL.getTime() - 5 * 3600_000);
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));

  const urgencyColor = countPast
    ? '#dc2626'
    : secsToCount < 1800
    ? '#f59e0b'
    : '#059669';

  return (
    <div className="card p-5">
      {/* Time bar */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--muted)] font-medium">
          {start ? format(start, 'HH:mm') : '—'}
        </span>
        <span className="text-xs font-semibold" style={{ color: 'var(--primary)' }}>
          Count due {format(countDL, 'HH:mm')}
        </span>
        <span className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
          Recount due {format(recountDL, 'HH:mm')}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 rounded-full bg-slate-100 mb-3 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-1000"
          style={{ width: `${progress * 100}%`, background: urgencyColor }}
        />
        {/* Count deadline marker */}
        <div
          className="absolute top-0 w-0.5 h-full bg-blue-400 opacity-50"
          style={{ left: `${((countDL.getTime() - (start?.getTime() ?? countDL.getTime() - 5 * 3600_000)) / totalMs) * 100}%` }}
        />
      </div>

      {/* Countdown */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Current time</div>
          <div
            className="text-2xl font-bold mt-0.5"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}
          >
            {format(now, 'HH:mm:ss')}
          </div>
        </div>

        {!countPast && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">To count deadline</div>
            <div
              className="text-lg font-bold mt-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: urgencyColor }}
            >
              {fmtCountdown(secsToCount)}
            </div>
          </div>
        )}

        {countPast && !recountPast && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">To recount deadline</div>
            <div
              className="text-lg font-bold mt-0.5"
              style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b' }}
            >
              {fmtCountdown(secsToRecount)}
            </div>
          </div>
        )}

        {recountPast && (
          <div
            className="badge badge-red text-sm px-3 py-1"
          >
            Recount window closed
          </div>
        )}
      </div>
    </div>
  );
}
