import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/bom/wip-scan-totals
// Returns scan totals per WIP code for the active stock take.
// Applies per-item latest-round replacement for count 2 (same logic as end-counting).
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

  // 3. Get sessions for count_number + round_number mapping
  const { data: sessions } = await supabase
    .from('scan_sessions')
    .select('id, count_number, round_number')
    .eq('stock_take_id', st.id);

  if (!sessions || sessions.length === 0) return NextResponse.json({});
  const sessionMap = new Map(sessions.map(s => [s.id, { cn: s.count_number as number, round: s.round_number || 1 }]));

  // 4. Get scan_records for WIP barcodes (physical scans only)
  const wipVariants = [...new Set(wipCodes.flatMap(w => [w, w.toUpperCase()]))];
  const { data: records } = await supabase
    .from('scan_records')
    .select('barcode, quantity, session_id')
    .eq('stock_take_id', st.id)
    .in('barcode', wipVariants)
    .is('chained_from', null);

  if (!records) return NextResponse.json({});

  // Build canonical lookup (case-insensitive)
  const canonicalMap = new Map(wipCodes.map(w => [w.toUpperCase(), w]));
  const toCanonical = (barcode: string) => canonicalMap.get(barcode.toUpperCase()) || barcode;

  // 5. Per-item latest-round for count 2: find max round per WIP
  const maxRoundC2: Record<string, number> = {};
  for (const r of records) {
    const sess = sessionMap.get(r.session_id);
    if (!sess || sess.cn !== 2) continue;
    const wip = toCanonical(r.barcode);
    maxRoundC2[wip] = Math.max(maxRoundC2[wip] ?? 0, sess.round);
  }

  // 6. Aggregate by WIP code + count_number, applying round filter for count 2
  const totals: Record<string, { count1: number; count2: number }> = {};
  for (const r of records) {
    const sess = sessionMap.get(r.session_id);
    if (!sess) continue;
    const wip = toCanonical(r.barcode);
    if (!totals[wip]) totals[wip] = { count1: 0, count2: 0 };

    if (sess.cn === 1) {
      totals[wip].count1 += r.quantity;
    } else if (sess.cn === 2) {
      // Only include latest round (per-item replacement)
      const maxRound = maxRoundC2[wip] ?? 0;
      if (maxRound > 0 && sess.round < maxRound) continue;
      totals[wip].count2 += r.quantity;
    }
  }

  return NextResponse.json(totals);
}
