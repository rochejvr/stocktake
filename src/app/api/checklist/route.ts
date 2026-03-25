import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/checklist?stockTakeId=xxx
// Returns checklist items, signoffs, and observation counts for a stock take
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json({ items: [], signoffs: [], observations: [] });

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) {
    return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });
  }

  const [{ data: items }, { data: signoffs }, { data: observations }] = await Promise.all([
    supabase
      .from('checklist_items')
      .select('*')
      .eq('stock_take_id', stockTakeId)
      .order('phase')
      .order('sort_order'),
    supabase
      .from('checklist_signoffs')
      .select('*')
      .eq('stock_take_id', stockTakeId),
    supabase
      .from('checklist_observations')
      .select('*')
      .eq('stock_take_id', stockTakeId)
      .order('reported_at', { ascending: false }),
  ]);

  return NextResponse.json({
    items: items || [],
    signoffs: signoffs || [],
    observations: observations || [],
  });
}

// POST /api/checklist — seed checklist items for a stock take
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { stockTakeId } = await request.json();
  if (!stockTakeId) {
    return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('seed_checklist_items', {
    p_stock_take_id: stockTakeId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ seeded: data });
}
