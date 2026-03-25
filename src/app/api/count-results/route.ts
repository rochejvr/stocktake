import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/count-results?stockTakeId=xxx&filter=all|flagged|variance|uncounted
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json([]);

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  const filter = request.nextUrl.searchParams.get('filter') || 'all';

  let query = supabase
    .from('count_results')
    .select('*')
    .eq('stock_take_id', stockTakeId)
    .order('part_number');

  if (filter === 'flagged') {
    query = query.eq('recount_flagged', true);
  } else if (filter === 'variance') {
    query = query.neq('variance_qty', 0).not('variance_qty', 'is', null);
  } else if (filter === 'uncounted') {
    query = query.is('count1_qty', null);
  } else if (filter === 'accepted') {
    query = query.eq('deviation_accepted', true);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
