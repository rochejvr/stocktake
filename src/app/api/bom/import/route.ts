import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

/**
 * Parse BOM Mapping Excel file.
 *
 * Format:
 *   Sheet: "BOM Mapping"
 *   Row 0: Store 001 inventory quantities   (__EMPTY = "Store 001", part cols = qty)
 *   Row 1: Store 002 inventory quantities   (__EMPTY = "Store 002")
 *   Row 2: Total inventory quantities       (__EMPTY = "Total")
 *   Row 3: Column headers                   (__EMPTY_1 = "Store 001", _2 = "Store 002", _3 = "Total")
 *   Row 4+: WIP entries
 *     __EMPTY  = WIP code  (e.g. "WIP23000032")
 *     __EMPTY_1 = Store 001 WIP count
 *     __EMPTY_2 = Store 002 WIP count
 *     __EMPTY_3 = Total WIP count
 *     XM400-xxx = qty of that component per WIP unit
 */
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return NextResponse.json({ error: 'Failed to parse Excel file' }, { status: 400 });
  }

  // Find the BOM sheet
  const sheetName = workbook.SheetNames.find(s =>
    s.toLowerCase().includes('bom') || s.toLowerCase().includes('mapping')
  ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });

  const SKIP_LABELS = ['store 001', 'store 002', 'total', ''];

  const mappings: { wip_code: string; component_code: string; qty_per_wip: number }[] = [];
  const errors: string[] = [];
  let wipRowCount = 0;

  for (const row of rows) {
    const wipCode = String(row['__EMPTY'] || '').trim();

    // Skip header rows and non-WIP rows
    if (SKIP_LABELS.includes(wipCode.toLowerCase())) continue;
    if (!wipCode) continue;

    // Only process WIP rows (start with WIP or similar)
    // Comment out this guard if you want to import non-WIP BOMs too
    wipRowCount++;

    // All remaining keys (not __EMPTY, __EMPTY_1, __EMPTY_2, __EMPTY_3) are component codes
    const componentKeys = Object.keys(row).filter(k => !k.startsWith('__EMPTY'));

    for (const componentCode of componentKeys) {
      const qty = parseFloat(String(row[componentCode]).replace(/[^0-9.-]/g, ''));
      if (!qty || qty <= 0) continue;

      mappings.push({
        wip_code: wipCode,
        component_code: componentCode,
        qty_per_wip: qty,
      });
    }
  }

  if (mappings.length === 0) {
    return NextResponse.json({
      error: `No BOM data found. Processed ${wipRowCount} WIP rows but found no non-zero component quantities.`,
    }, { status: 400 });
  }

  // Upsert mappings in batches
  const BATCH = 500;
  for (let i = 0; i < mappings.length; i += BATCH) {
    const batch = mappings.slice(i, i + BATCH);
    const { error } = await supabase
      .from('bom_mappings')
      .upsert(batch, { onConflict: 'wip_code,component_code', ignoreDuplicates: false });
    if (error) errors.push(`Batch ${i / BATCH + 1}: ${error.message}`);
  }

  // Sync descriptions + missing flags via single RPC (requires migration 003)
  const { error: rpcErr } = await supabase.rpc('sync_bom_descriptions');
  if (rpcErr) {
    console.error('[BOM Import] sync_bom_descriptions RPC error:', rpcErr.message);
  }

  // Count missing for response info (quick aggregate query)
  const { count: missingCount } = await supabase
    .from('bom_mappings')
    .select('*', { count: 'exact', head: true })
    .eq('missing_from_inventory', true);

  return NextResponse.json({
    imported: mappings.length,
    wipCodes: wipRowCount,
    missingFromInventory: missingCount,
    errors,
  });
}
