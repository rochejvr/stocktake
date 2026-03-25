import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/checklist/signoffs — sign off a department's phase
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { stock_take_id, phase, department, signed_by } = await request.json();

  if (!stock_take_id || !phase || !department || !signed_by) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Check all items for this department+phase are completed
  const { data: items } = await supabase
    .from('checklist_items')
    .select('id, completed_at')
    .eq('stock_take_id', stock_take_id)
    .eq('phase', phase)
    .eq('department', department);

  const incomplete = (items || []).filter(i => !i.completed_at);
  if (incomplete.length > 0) {
    return NextResponse.json(
      { error: `${incomplete.length} item(s) still incomplete` },
      { status: 400 }
    );
  }

  // Check no open observations for this department+phase
  const { data: openObs } = await supabase
    .from('checklist_observations')
    .select('id')
    .eq('stock_take_id', stock_take_id)
    .eq('phase', phase)
    .eq('department', department)
    .in('status', ['open', 'in_progress']);

  if (openObs && openObs.length > 0) {
    return NextResponse.json(
      { error: `${openObs.length} open observation(s) must be closed first` },
      { status: 400 }
    );
  }

  // Upsert signoff
  const { data, error } = await supabase
    .from('checklist_signoffs')
    .upsert(
      { stock_take_id, phase, department, signed_by },
      { onConflict: 'stock_take_id,phase,department' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/checklist/signoffs — revoke a signoff (admin only, for corrections)
export async function DELETE(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { stock_take_id, phase, department } = await request.json();

  const { error } = await supabase
    .from('checklist_signoffs')
    .delete()
    .eq('stock_take_id', stock_take_id)
    .eq('phase', phase)
    .eq('department', department);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ revoked: true });
}
