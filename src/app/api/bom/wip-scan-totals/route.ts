import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/bom/wip-scan-totals
// Returns scan totals per WIP code for the active stock take.
// Response: { [wipCode]: { count1: number, count2: number } }
export async function GET() {
  if (!supabase) return NextResponse.json({});

  // 1. Get active stock take
  const { data: st } = await supabase
    .from('stock_takes')
    .select('id')
    .not('status', 'eq', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!st) return NextResponse.json({});

  // 2. Get all WIP codes from bom_mappings
  const { data: wips } = await supabase
    .from('bom_mappings')
    .select('wip_code');

  if (!wips || wips.length === 0) return NextResponse.json({});
  const wipCodes = [...new Set(wips.map(w => w.wip_code))];

  // 3. Get sessions for count_number mapping
  const { data: sessions } = await supabase
    .from('scan_sessions')
    .select('id, count_number')
    .eq('stock_take_id', st.id);

  if (!sessions || sessions.length === 0) return NextResponse.json({});
  const sessionCountMap = new Map(sessions.map(s => [s.id, s.count_number as number]));

  // 4. Get scan_records for WIP barcodes (physical scans only, case-insensitive)
  // Include both canonical and uppercase variants for historical data
  const wipVariants = [...new Set(wipCodes.flatMap(w => [w, w.toUpperCase()]))];
  const { data: records } = await supabase
    .from('scan_records')
    .select('barcode, quantity, session_id')
    .eq('stock_take_id', st.id)
    .in('barcode', wipVariants)
    .is('chained_from', null);

  if (!records) return NextResponse.json({});

  // 5. Aggregate by WIP code + count_number
  const totals: Record<string, { count1: number; count2: number }> = {};
  for (const r of records) {
    const cn = sessionCountMap.get(r.session_id);
    if (!cn) continue;
    const wip = r.barcode.toUpperCase(); // normalize
    // Find canonical casing
    const canonical = wipCodes.find(w => w.toUpperCase() === wip) || r.barcode;
    if (!totals[canonical]) totals[canonical] = { count1: 0, count2: 0 };
    if (cn === 1) totals[canonical].count1 += r.quantity;
    else if (cn === 2) totals[canonical].count2 += r.quantity;
  }

  return NextResponse.json(totals);
}
