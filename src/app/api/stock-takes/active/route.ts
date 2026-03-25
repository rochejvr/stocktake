import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  if (!supabase) return NextResponse.json({ stockTake: null, stats: null });

  const { data: stockTake } = await supabase
    .from('stock_takes')
    .select('*')
    .not('status', 'eq', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!stockTake) return NextResponse.json({ stockTake: null, stats: null });

  // Compute stats — count unique parts (not per-store duplicates)
  const [{ data: distinctParts }, { data: sessions }, { data: flagged }] = await Promise.all([
    supabase.from('pastel_inventory').select('part_number').eq('stock_take_id', stockTake.id),
    supabase.from('scan_sessions').select('id, submitted_at').eq('stock_take_id', stockTake.id),
    supabase.from('count_results').select('id').eq('stock_take_id', stockTake.id).eq('recount_flagged', true),
  ]);
  const totalParts = new Set((distinctParts || []).map(r => r.part_number)).size;

  const { count: countedParts } = await supabase
    .from('scan_records')
    .select('barcode', { count: 'exact', head: true })
    .eq('stock_take_id', stockTake.id);

  const stats = {
    totalParts,
    countedParts: countedParts ?? 0,
    activeSessions: sessions?.filter(s => !s.submitted_at).length ?? 0,
    submittedSessions: sessions?.filter(s => s.submitted_at).length ?? 0,
    flaggedForRecount: flagged?.length ?? 0,
    overallVariancePct: null,
  };

  return NextResponse.json({ stockTake, stats });
}
