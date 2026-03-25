import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/count-results/[id] — accept/reject deviation, manual flag
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;
  const body = await request.json();

  const allowedFields = [
    'deviation_accepted', 'accepted_by', 'accepted_at', 'accepted_qty',
    'recount_flagged', 'recount_reasons',
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) update[key] = body[key];
  }

  // If accepting deviation, recalculate variance based on accepted qty
  if (body.deviation_accepted === true && body.accepted_qty !== undefined) {
    const { data: existing } = await supabase
      .from('count_results')
      .select('pastel_qty')
      .eq('id', id)
      .single();

    if (existing) {
      const varianceQty = body.accepted_qty - existing.pastel_qty;
      const variancePct = existing.pastel_qty !== 0
        ? (varianceQty / existing.pastel_qty) * 100
        : (body.accepted_qty !== 0 ? 100 : 0);
      update.variance_qty = varianceQty;
      update.variance_pct = variancePct;
    }
  }

  // If un-accepting, revert variance to latest count qty
  if (body.deviation_accepted === null) {
    const { data: existing } = await supabase
      .from('count_results')
      .select('pastel_qty, count1_qty, count2_qty')
      .eq('id', id)
      .single();

    if (existing) {
      const counted = existing.count2_qty ?? existing.count1_qty;
      if (counted !== null) {
        const varianceQty = counted - existing.pastel_qty;
        const variancePct = existing.pastel_qty !== 0
          ? (varianceQty / existing.pastel_qty) * 100
          : (counted !== 0 ? 100 : 0);
        update.variance_qty = varianceQty;
        update.variance_pct = variancePct;
      }
    }
  }

  const { data, error } = await supabase
    .from('count_results')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
