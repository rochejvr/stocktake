import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/stock-takes/[id]/export?glCode=2100000&includeZero=true
// Generates Pastel Inventory Journal CSV from accepted count results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;
  const glCode = request.nextUrl.searchParams.get('glCode') || '2100000';
  const includeZero = request.nextUrl.searchParams.get('includeZero') !== 'false';

  // Verify stock take exists and is in reviewing or complete status
  const { data: st, error: stErr } = await supabase
    .from('stock_takes')
    .select('*')
    .eq('id', id)
    .single();

  if (stErr || !st) return NextResponse.json({ error: 'Stock take not found' }, { status: 404 });
  if (st.status !== 'reviewing' && st.status !== 'complete') {
    return NextResponse.json({ error: `Stock take is in '${st.status}' status — must be reviewing or complete` }, { status: 400 });
  }

  // Get all accepted count results
  const { data: results, error: crErr } = await supabase
    .from('count_results')
    .select('*')
    .eq('stock_take_id', id)
    .eq('deviation_accepted', true)
    .order('part_number')
    .order('store_code');

  if (crErr) return NextResponse.json({ error: crErr.message }, { status: 500 });
  if (!results || results.length === 0) {
    return NextResponse.json({ error: 'No accepted results to export' }, { status: 400 });
  }

  // Build reference: max 8 chars uppercase. ST-2026-Q1 → STQ12026
  const ref = st.reference?.replace(/[^A-Z0-9]/gi, '').substring(0, 8).toUpperCase() || 'STOCKTK';

  // Format date as DD/MM/YYYY
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;

  // Build CSV rows — Pastel Inventory Journal format (9 columns, no header)
  const csvRows: string[] = [];

  for (const r of results) {
    // Variance = accepted_qty - pastel_qty
    const varianceQty = (r.accepted_qty ?? 0) - r.pastel_qty;

    // Skip zero variance if not including them
    if (!includeZero && varianceQty === 0) continue;

    // Format quantity: positive with leading space, negative with minus
    // Pastel uses format like " 3." or "-2."
    const qtyStr = varianceQty >= 0
      ? ` ${varianceQty}.`
      : `${varianceQty}.`;

    // Unit cost: use stored unit_cost, default to 0
    const cost = r.unit_cost !== null ? Number(r.unit_cost) : 0;
    const costStr = cost % 1 === 0 ? `${cost}` : `${cost}`;

    // Description: truncate to 20 chars for Pastel narration field
    const narration = (r.description || '').substring(0, 20);

    // Store code: 3 chars
    const store = (r.store_code || '001').padStart(3, '0');

    // CSV row: Date, Code, Narration, Reference, Qty, Cost, GL, Projects, Store
    csvRows.push(
      `"${dateStr}","${r.part_number}","${narration}","${ref}",${qtyStr},${costStr},"${glCode}","","${store}",`
    );
  }

  const csv = csvRows.join('\r\n');
  const filename = `${st.reference || 'stock-take'}_journal.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
