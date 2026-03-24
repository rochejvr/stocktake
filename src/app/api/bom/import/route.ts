import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const mappings: { wip_code: string; component_code: string; qty_per_wip: number; notes: string | null }[] = [];
  const errors: string[] = [];

  // Look for a sheet with BOM/WIP data
  // Expected columns: WIP Code | Component Code | Qty | Notes (flexible)
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    for (const row of rows) {
      const keys = Object.keys(row).map(k => k.toLowerCase().trim());
      const wipKey  = Object.keys(row).find(k => k.toLowerCase().includes('wip'));
      const compKey = Object.keys(row).find(k => k.toLowerCase().includes('component') || k.toLowerCase().includes('part'));
      const qtyKey  = Object.keys(row).find(k => k.toLowerCase().includes('qty') || k.toLowerCase().includes('quantity'));
      const notesKey = Object.keys(row).find(k => k.toLowerCase().includes('note'));

      if (!wipKey || !compKey) continue;

      const wipCode  = String(row[wipKey]).trim();
      const compCode = String(row[compKey]).trim();
      const qty      = qtyKey ? parseFloat(String(row[qtyKey])) || 1 : 1;
      const notes    = notesKey ? String(row[notesKey]).trim() || null : null;

      if (!wipCode || !compCode || wipCode === '' || compCode === '') continue;

      mappings.push({ wip_code: wipCode, component_code: compCode, qty_per_wip: qty, notes });
    }
  }

  if (mappings.length === 0) {
    return NextResponse.json({ error: 'No valid BOM rows found. Expected columns: WIP Code, Component Code, Qty.' }, { status: 400 });
  }

  // Upsert mappings
  const { error } = await supabase
    .from('bom_mappings')
    .upsert(mappings, { onConflict: 'wip_code,component_code', ignoreDuplicates: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ imported: mappings.length, errors });
}
