'use client';

import { useState, useEffect } from 'react';

interface ComponentSearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function ComponentSearch({ value, onChange, placeholder, autoFocus }: ComponentSearchProps) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<{ part_number: string; description: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (query.length < 2) { setOptions([]); return; }
    const timeout = setTimeout(() => {
      fetch(`/api/components?search=${encodeURIComponent(query)}&active=true`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setOptions(data.slice(0, 20)); });
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative">
      <input
        className="input font-mono text-xs"
        placeholder={placeholder || 'Search component...'}
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (options.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        autoFocus={autoFocus}
      />
      {open && options.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border bg-white shadow-lg"
          style={{ borderColor: 'var(--card-border)' }}>
          {options.map(o => (
            <button
              key={o.part_number}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b last:border-b-0 transition-colors"
              style={{ borderColor: 'var(--card-border-light)' }}
              onMouseDown={() => { setQuery(o.part_number); onChange(o.part_number); setOpen(false); }}
            >
              <span className="font-mono font-medium">{o.part_number}</span>
              {o.description && <span className="text-[var(--muted)] ml-2">{o.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
