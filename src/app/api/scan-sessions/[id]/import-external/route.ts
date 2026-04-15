import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

interface ParsedRow {
  part_number: string;
  description: string;
  vendor: string;
  quantity: number;
  notes: string;
  valid: boolean;
  error?: string;
}

// POST /api/scan-sessions/[id]/import-external
// Two modes:
//   - Preview: parse Excel and validate against Pastel inventory
//   - Confirm: ?confirm=true — insert records into scan_records
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id: sessionId } = await params;
  const isConfirm = request.nextUrl.searchParams.get('confirm') === 'true';

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const stockTakeId = formData.get('stock_take_id') as string | null;
  const userName = formData.get('user_name') as string | null;

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!stockTakeId) return NextResponse.json({ error: 'stock_take_id required' }, { status: 400 });
  if (!userName) return NextResponse.json({ error: 'user_name required' }, { status: 400 });

  // Parse Excel file
  const buffer = Buffer.from(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return NextResponse.json({ error: 'Failed to parse Excel file' }, { status: 400 });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  // Find the header row by looking for "Item Number" in any cell
  let headerIdx = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').trim().toLowerCase();
      if (cell === 'item number' || cell === 'item_number' || cell === 'part number' || cell === 'part_number') {
        headerIdx = i;
        // Map column headers
        for (let k = 0; k < row.length; k++) {
          const h = String(row[k] || '').trim().toLowerCase();
          if (h.includes('item') || h.includes('part')) colMap['part_number'] = k;
          else if (h.includes('desc')) colMap['description'] = k;
          else if (h.includes('vendor') || h.includes('supplier')) colMap['vendor'] = k;
          else if (h.includes('stock') || h.includes('qty') || h.includes('quantity') || h.includes('update')) colMap['quantity'] = k;
          else if (h.includes('note')) colMap['notes'] = k;
        }
        break;
      }
    }
    if (headerIdx >= 0) break;
  }

  if (headerIdx < 0) {
    return NextResponse.json({ error: 'Could not find header row with "Item Number" column' }, { status: 400 });
  }

  // Parse data rows
  const parsed: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const partNumber = String(row[colMap['part_number'] ?? 0] || '').trim();
    if (!partNumber) continue;

    const quantity = Number(row[colMap['quantity'] ?? 3] || 0);
    const description = String(row[colMap['description'] ?? 1] || '').trim();
    const vendor = String(row[colMap['vendor'] ?? 2] || '').trim();
    const notes = String(row[colMap['notes'] ?? 4] || '').trim();

    if (isNaN(quantity) || quantity <= 0) {
      parsed.push({ part_number: partNumber, description, vendor, quantity: 0, notes, valid: false, error: 'Invalid or zero quantity' });
      continue;
    }

    parsed.push({ part_number: partNumber, description, vendor, quantity, notes, valid: true });
  }

  // Validate part numbers against pastel_inventory
  if (parsed.length > 0) {
    const partNumbers = parsed.filter(p => p.valid).map(p => p.part_number);
    const { data: inventoryItems } = await supabase
      .from('pastel_inventory')
      .select('part_number')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', partNumbers);

    const validParts = new Set((inventoryItems || []).map(i => i.part_number));
    for (const row of parsed) {
      if (row.valid && !validParts.has(row.part_number)) {
        row.valid = false;
        row.error = 'Part number not in Pastel inventory';
      }
    }
  }

  const validRows = parsed.filter(p => p.valid);
  const invalidRows = parsed.filter(p => !p.valid);

  // Preview mode: return parsed rows without inserting
  if (!isConfirm) {
    return NextResponse.json({
      valid: validRows,
      invalid: invalidRows,
      total: parsed.length,
    });
  }

  // Confirm mode: insert valid rows as scan_records
  if (validRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows to import' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const toInsert = validRows.map(r => ({
    session_id: sessionId,
    stock_take_id: stockTakeId,
    barcode: r.part_number,
    quantity: r.quantity,
    scanned_at: now,
    user_name: userName,
    store_code: '001',
    chained_from: null,
    source: 'external',
  }));

  const { data: inserted, error } = await supabase
    .from('scan_records')
    .insert(toInsert)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    imported: inserted?.length || 0,
    skipped: invalidRows.length,
    records: inserted,
  });
}
